// Package mp4cut extracts a time range from a progressive (non-fragmented)
// MP4 file without re-encoding.
//
// サンプルの実体は mdat からバイト単位でコピーするだけなのでコーデックには依存しない
// （H.264 / HEVC / AV1 いずれも可）。ただし開始点は必ず sync sample（キーフレーム）に
// スナップされるため、指定した開始時刻より前にずれることがある。
//
// 制限（最小版）:
//   - fragmented MP4 (moof/mfra) は非対応
//   - edts/elst は破棄する（切り出し後のタイムラインでは意味を持たないため）
//   - sdtp/sbgp/sgpd/subs/saio/saiz など任意の補助テーブルは破棄する
package mp4cut

import (
	"errors"
	"fmt"
	"io"
	"os"
	"sort"

	"github.com/Eyevinn/mp4ff/mp4"
)

// Result reports what was actually written. Start/End は要求値ではなく
// キーフレームスナップ後の実際の値。
type Result struct {
	OutputPath string  `json:"outputPath"`
	StartSec   float64 `json:"startSec"`
	EndSec     float64 `json:"endSec"`
	Size       int64   `json:"size"`
}

// outChunk is one contiguous byte range in the input that becomes one chunk
// in the output. 入力チャンクを範囲の端で切り詰めたものに対応する。
type outChunk struct {
	inOffset  uint64
	size      uint64
	nrSamples uint32
	sdID      uint32
	outOffset uint64
	plan      *trakPlan
}

type trakPlan struct {
	trak        *mp4.TrakBox
	first, last uint32 // 1-based, inclusive
	chunks      []*outChunk
	mediaDur    uint64 // 新しい mdhd.Duration（メディアタイムスケール）
}

// Cut writes the [startSec, endSec) range of srcPath to dstPath.
func Cut(srcPath, dstPath string, startSec, endSec float64) (*Result, error) {
	if startSec < 0 {
		startSec = 0
	}
	if endSec <= startSec {
		return nil, fmt.Errorf("mp4cut: 終了時刻(%.3f)が開始時刻(%.3f)以下です", endSec, startSec)
	}

	src, err := os.Open(srcPath)
	if err != nil {
		return nil, fmt.Errorf("mp4cut: 入力を開けません: %w", err)
	}
	defer src.Close()

	in, err := mp4.DecodeFile(src, mp4.WithDecodeMode(mp4.DecModeLazyMdat))
	if err != nil {
		return nil, fmt.Errorf("mp4cut: MP4を解析できません: %w", err)
	}
	if in.IsFragmented() {
		return nil, errors.New("mp4cut: fragmented MP4 は未対応です")
	}
	if in.Moov == nil || in.Mdat == nil {
		return nil, errors.New("mp4cut: moov または mdat が見つかりません")
	}

	plans, refStart, refEnd, refTimescale, err := planTraks(in.Moov, startSec, endSec)
	if err != nil {
		return nil, err
	}

	payloadSize, use64 := layoutChunks(plans)

	// mdat ヘッダは 4GB 超で largesize (16バイト) になる。
	mdatHeaderSize := uint64(8)
	if payloadSize+8 >= 1<<32 {
		mdatHeaderSize = 16
	}

	if err := rebuildTraks(in.Moov, plans, use64); err != nil {
		return nil, err
	}

	// ここまででボックスサイズは確定する（エントリ数が決まったため）。
	// mdat 本体の開始位置を求めてから chunk offset を絶対値に直す。
	var sizeWithoutMdat uint64
	for _, box := range in.Children {
		if box.Type() != "mdat" {
			sizeWithoutMdat += box.Size()
		}
	}
	shiftChunkOffsets(plans, sizeWithoutMdat+mdatHeaderSize)

	out, err := os.Create(dstPath)
	if err != nil {
		return nil, fmt.Errorf("mp4cut: 出力を作成できません: %w", err)
	}
	if err := writeFile(in, plans, payloadSize, mdatHeaderSize, out, src); err != nil {
		out.Close()
		os.Remove(dstPath)
		return nil, err
	}
	if err := out.Close(); err != nil {
		os.Remove(dstPath)
		return nil, fmt.Errorf("mp4cut: 出力を閉じられません: %w", err)
	}

	return &Result{
		OutputPath: dstPath,
		StartSec:   float64(refStart) / float64(refTimescale),
		EndSec:     float64(refEnd) / float64(refTimescale),
		Size:       int64(sizeWithoutMdat + mdatHeaderSize + payloadSize),
	}, nil
}

// planTraks decides the sample range of every trak. 基準トラック（映像優先）で
// キーフレームにスナップした時刻を全トラックに適用する。
func planTraks(moov *mp4.MoovBox, startSec, endSec float64) (plans []*trakPlan, refStart, refEnd uint64, refTimescale uint32, err error) {
	if len(moov.Traks) == 0 {
		return nil, 0, 0, 0, errors.New("mp4cut: トラックがありません")
	}
	ref := referenceTrak(moov)
	refStbl := ref.Mdia.Minf.Stbl
	refTimescale = ref.Mdia.Mdhd.Timescale
	if refTimescale == 0 {
		return nil, 0, 0, 0, errors.New("mp4cut: タイムスケールが 0 です")
	}
	refN := refStbl.Stsz.GetNrSamples()
	if refN == 0 {
		return nil, 0, 0, 0, errors.New("mp4cut: 基準トラックにサンプルがありません")
	}

	first := sampleContainingTime(refStbl.Stts, uint64(startSec*float64(refTimescale)), refN)
	if refStbl.Stss != nil {
		first = syncSampleAtOrBefore(refStbl.Stss, first)
	}
	last := lastSampleBeforeTime(refStbl.Stts, uint64(endSec*float64(refTimescale)), refN)
	if last < first {
		last = first
	}

	refStart, _ = refStbl.Stts.GetDecodeTime(first)
	lastDec, lastDur := refStbl.Stts.GetDecodeTime(last)
	refEnd = lastDec + uint64(lastDur)

	for _, trak := range moov.Traks {
		stbl := trak.Mdia.Minf.Stbl
		if stbl == nil || stbl.Stts == nil || stbl.Stsc == nil || stbl.Stsz == nil {
			return nil, 0, 0, 0, fmt.Errorf("mp4cut: トラック %d のサンプルテーブルが不完全です", trak.Tkhd.TrackID)
		}
		p := &trakPlan{trak: trak}
		if trak == ref {
			p.first, p.last = first, last
		} else {
			ts := trak.Mdia.Mdhd.Timescale
			if ts == 0 {
				return nil, 0, 0, 0, fmt.Errorf("mp4cut: トラック %d のタイムスケールが 0 です", trak.Tkhd.TrackID)
			}
			n := stbl.Stsz.GetNrSamples()
			if n == 0 {
				continue // 空トラックはそのまま素通しできないので除外する
			}
			p.first = sampleContainingTime(stbl.Stts, refStart*uint64(ts)/uint64(refTimescale), n)
			p.last = lastSampleBeforeTime(stbl.Stts, refEnd*uint64(ts)/uint64(refTimescale), n)
			if p.last < p.first {
				p.last = p.first
			}
		}
		if err := buildChunks(p); err != nil {
			return nil, 0, 0, 0, err
		}
		plans = append(plans, p)
	}
	if len(plans) == 0 {
		return nil, 0, 0, 0, errors.New("mp4cut: 切り出せるトラックがありません")
	}
	return plans, refStart, refEnd, refTimescale, nil
}

func referenceTrak(moov *mp4.MoovBox) *mp4.TrakBox {
	for _, trak := range moov.Traks {
		if trak.Mdia != nil && trak.Mdia.Hdlr != nil && trak.Mdia.Hdlr.HandlerType == "vide" {
			return trak
		}
	}
	return moov.Traks[0]
}

// sampleContainingTime returns the 1-based sample whose decode interval covers t.
func sampleContainingTime(stts *mp4.SttsBox, t uint64, nSamples uint32) uint32 {
	nr, err := stts.GetSampleNrAtTime(t)
	if err != nil || nr > nSamples {
		return nSamples
	}
	if nr == 0 {
		return 1
	}
	// GetSampleNrAtTime は切り上げなので、開始時刻が t を超えていれば一つ戻す。
	if dec, _ := stts.GetDecodeTime(nr); dec > t && nr > 1 {
		nr--
	}
	return nr
}

// lastSampleBeforeTime returns the last 1-based sample starting strictly before t.
func lastSampleBeforeTime(stts *mp4.SttsBox, t uint64, nSamples uint32) uint32 {
	nr, err := stts.GetSampleNrAtTime(t)
	if err != nil || nr > nSamples {
		return nSamples
	}
	if nr > 1 {
		return nr - 1
	}
	return 1
}

func syncSampleAtOrBefore(stss *mp4.StssBox, sampleNr uint32) uint32 {
	nums := stss.SampleNumber
	if len(nums) == 0 {
		return sampleNr
	}
	// nums は昇順。sampleNr 以下で最大のものを探す。
	i := sort.Search(len(nums), func(i int) bool { return nums[i] > sampleNr })
	if i == 0 {
		return nums[0]
	}
	return nums[i-1]
}

// buildChunks maps the sample range onto input chunks, splitting the first and
// last chunk at the range boundary.
func buildChunks(p *trakPlan) error {
	stbl := p.trak.Mdia.Minf.Stbl
	chunks, err := stbl.Stsc.GetContainingChunks(p.first, p.last)
	if err != nil {
		return fmt.Errorf("mp4cut: トラック %d のチャンク解決に失敗: %w", p.trak.Tkhd.TrackID, err)
	}
	for _, c := range chunks {
		sStart := max32(c.StartSampleNr, p.first)
		sEnd := min32(c.StartSampleNr+c.NrSamples-1, p.last)
		if sEnd < sStart {
			continue
		}
		base, err := chunkOffset(stbl, c.ChunkNr)
		if err != nil {
			return fmt.Errorf("mp4cut: トラック %d のチャンクオフセット取得に失敗: %w", p.trak.Tkhd.TrackID, err)
		}
		// チャンク先頭から切り出し開始サンプルまでのバイト数を足す。
		skip, err := stbl.Stsz.GetTotalSampleSize(c.StartSampleNr, sStart-1)
		if err != nil {
			return fmt.Errorf("mp4cut: トラック %d のサンプルサイズ集計に失敗: %w", p.trak.Tkhd.TrackID, err)
		}
		size, err := stbl.Stsz.GetTotalSampleSize(sStart, sEnd)
		if err != nil {
			return fmt.Errorf("mp4cut: トラック %d のサンプルサイズ集計に失敗: %w", p.trak.Tkhd.TrackID, err)
		}
		p.chunks = append(p.chunks, &outChunk{
			inOffset:  base + skip,
			size:      size,
			nrSamples: sEnd - sStart + 1,
			sdID:      stbl.Stsc.GetSampleDescriptionID(int(c.ChunkNr)),
			plan:      p,
		})
	}
	if len(p.chunks) == 0 {
		return fmt.Errorf("mp4cut: トラック %d に切り出すサンプルがありません", p.trak.Tkhd.TrackID)
	}
	return nil
}

// layoutChunks assigns output offsets in input-offset order so that the mdat
// copy stays sequential and the original interleaving is preserved.
func layoutChunks(plans []*trakPlan) (payloadSize uint64, use64 bool) {
	var all []*outChunk
	for _, p := range plans {
		all = append(all, p.chunks...)
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].inOffset < all[j].inOffset })
	for _, c := range all {
		c.outOffset = payloadSize
		payloadSize += c.size
	}
	// moov 分の余裕を見て 32bit に収まらない可能性があれば co64 にする。
	use64 = payloadSize >= 1<<32-(1<<28)
	return payloadSize, use64
}

func shiftChunkOffsets(plans []*trakPlan, base uint64) {
	for _, p := range plans {
		stbl := p.trak.Mdia.Minf.Stbl
		for i, c := range p.chunks {
			abs := base + c.outOffset
			if stbl.Co64 != nil {
				stbl.Co64.ChunkOffset[i] = abs
			} else {
				stbl.Stco.ChunkOffset[i] = uint32(abs)
			}
		}
	}
}

// rebuildTraks replaces each trak's stbl with freshly built sample tables and
// fixes up the durations. moov.Traks も切り出し対象だけに絞る。
func rebuildTraks(moov *mp4.MoovBox, plans []*trakPlan, use64 bool) error {
	var maxTrakDur uint64
	for _, p := range plans {
		stbl := p.trak.Mdia.Minf.Stbl
		newStbl := mp4.NewStblBox()
		newStbl.AddChild(stbl.Stsd)

		stts, mediaDur := buildStts(stbl.Stts, p.first, p.last)
		p.mediaDur = mediaDur
		newStbl.AddChild(stts)

		if stbl.Ctts != nil {
			newStbl.AddChild(buildCtts(stbl.Ctts, p.first, p.last))
		}
		newStbl.AddChild(buildStsc(p.chunks))
		newStbl.AddChild(buildStsz(stbl.Stsz, p.first, p.last))
		if stbl.Stss != nil {
			newStbl.AddChild(buildStss(stbl.Stss, p.first, p.last))
		}
		if use64 {
			newStbl.AddChild(&mp4.Co64Box{ChunkOffset: make([]uint64, len(p.chunks))})
		} else {
			newStbl.AddChild(&mp4.StcoBox{ChunkOffset: make([]uint32, len(p.chunks))})
		}
		replaceChild(&p.trak.Mdia.Minf.Children, stbl, newStbl)
		p.trak.Mdia.Minf.Stbl = newStbl

		// edts/elst は元のタイムラインを指しているため破棄する。
		if p.trak.Edts != nil {
			removeChild(&p.trak.Children, p.trak.Edts)
			p.trak.Edts = nil
		}

		p.trak.Mdia.Mdhd.Duration = mediaDur
		trakDur := mediaDur * uint64(moov.Mvhd.Timescale) / uint64(p.trak.Mdia.Mdhd.Timescale)
		p.trak.Tkhd.Duration = trakDur
		if trakDur > maxTrakDur {
			maxTrakDur = trakDur
		}
	}
	moov.Mvhd.Duration = maxTrakDur

	// 空トラックを落とした場合に moov.Traks / Children を合わせる。
	kept := make(map[*mp4.TrakBox]bool, len(plans))
	for _, p := range plans {
		kept[p.trak] = true
	}
	for _, trak := range moov.Traks {
		if !kept[trak] {
			removeChild(&moov.Children, trak)
		}
	}
	traks := moov.Traks[:0]
	for _, trak := range moov.Traks {
		if kept[trak] {
			traks = append(traks, trak)
		}
	}
	moov.Traks = traks
	return nil
}

func buildStts(in *mp4.SttsBox, first, last uint32) (*mp4.SttsBox, uint64) {
	out := &mp4.SttsBox{Version: in.Version, Flags: in.Flags}
	var total uint64
	for nr := first; nr <= last; nr++ {
		dur := in.GetDur(nr)
		total += uint64(dur)
		n := len(out.SampleTimeDelta)
		if n > 0 && out.SampleTimeDelta[n-1] == dur {
			out.SampleCount[n-1]++
			continue
		}
		out.SampleTimeDelta = append(out.SampleTimeDelta, dur)
		out.SampleCount = append(out.SampleCount, 1)
	}
	return out, total
}

func buildCtts(in *mp4.CttsBox, first, last uint32) *mp4.CttsBox {
	out := &mp4.CttsBox{Version: in.Version, Flags: in.Flags}
	var counts []uint32
	var offsets []int32
	for nr := first; nr <= last; nr++ {
		off := in.GetCompositionTimeOffset(nr)
		if n := len(offsets); n > 0 && offsets[n-1] == off {
			counts[n-1]++
			continue
		}
		offsets = append(offsets, off)
		counts = append(counts, 1)
	}
	_ = out.AddSampleCountsAndOffset(counts, offsets)
	return out
}

func buildStsc(chunks []*outChunk) *mp4.StscBox {
	out := &mp4.StscBox{}
	var prevSamples, prevSdID uint32
	for i, c := range chunks {
		if uint32(i) > 0 && c.nrSamples == prevSamples && c.sdID == prevSdID {
			continue // 直前のエントリでカバーされる
		}
		_ = out.AddEntry(uint32(i+1), c.nrSamples, c.sdID)
		prevSamples, prevSdID = c.nrSamples, c.sdID
	}
	return out
}

func buildStsz(in *mp4.StszBox, first, last uint32) *mp4.StszBox {
	n := last - first + 1
	out := &mp4.StszBox{Version: in.Version, Flags: in.Flags, SampleNumber: n}
	if in.SampleUniformSize != 0 {
		out.SampleUniformSize = in.SampleUniformSize
		return out
	}
	out.SampleSize = make([]uint32, 0, n)
	for nr := first; nr <= last; nr++ {
		out.SampleSize = append(out.SampleSize, in.GetSampleSize(int(nr)))
	}
	return out
}

func buildStss(in *mp4.StssBox, first, last uint32) *mp4.StssBox {
	out := &mp4.StssBox{Version: in.Version, Flags: in.Flags}
	for _, nr := range in.SampleNumber {
		if nr < first {
			continue
		}
		if nr > last {
			break
		}
		out.SampleNumber = append(out.SampleNumber, nr-first+1)
	}
	return out
}

func writeFile(in *mp4.File, plans []*trakPlan, payloadSize, mdatHeaderSize uint64, w io.Writer, rs io.ReadSeeker) error {
	for _, box := range in.Children {
		if box.Type() == "mdat" {
			continue
		}
		if err := box.Encode(w); err != nil {
			return fmt.Errorf("mp4cut: %s の書き込みに失敗: %w", box.Type(), err)
		}
	}
	if err := mp4.EncodeHeaderWithSize("mdat", payloadSize+mdatHeaderSize, mdatHeaderSize == 16, w); err != nil {
		return fmt.Errorf("mp4cut: mdat ヘッダの書き込みに失敗: %w", err)
	}

	var written uint64
	for _, r := range mergedRanges(plans) {
		n, err := in.Mdat.CopyData(int64(r[0]), int64(r[1]), rs, w)
		if err != nil {
			return fmt.Errorf("mp4cut: mdat のコピーに失敗: %w", err)
		}
		written += uint64(n)
	}
	if written != payloadSize {
		return fmt.Errorf("mp4cut: mdat のコピー量が不一致 (%d != %d)", written, payloadSize)
	}
	return nil
}

// mergedRanges returns [offset, size] pairs sorted by offset, with adjacent
// ranges merged so the copy is done in as few reads as possible.
func mergedRanges(plans []*trakPlan) [][2]uint64 {
	var all []*outChunk
	for _, p := range plans {
		all = append(all, p.chunks...)
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].inOffset < all[j].inOffset })

	var out [][2]uint64
	for _, c := range all {
		if n := len(out); n > 0 && out[n-1][0]+out[n-1][1] == c.inOffset {
			out[n-1][1] += c.size
			continue
		}
		out = append(out, [2]uint64{c.inOffset, c.size})
	}
	return out
}

func chunkOffset(stbl *mp4.StblBox, chunkNr uint32) (uint64, error) {
	if stbl.Stco != nil {
		return stbl.Stco.GetOffset(int(chunkNr))
	}
	if stbl.Co64 != nil {
		return stbl.Co64.GetOffset(int(chunkNr))
	}
	return 0, errors.New("stco/co64 がありません")
}

func replaceChild(children *[]mp4.Box, old, new mp4.Box) {
	for i, c := range *children {
		if c == old {
			(*children)[i] = new
			return
		}
	}
	*children = append(*children, new)
}

func removeChild(children *[]mp4.Box, target mp4.Box) {
	for i, c := range *children {
		if c == target {
			*children = append((*children)[:i], (*children)[i+1:]...)
			return
		}
	}
}

func min32(a, b uint32) uint32 {
	if a < b {
		return a
	}
	return b
}

func max32(a, b uint32) uint32 {
	if a > b {
		return a
	}
	return b
}
