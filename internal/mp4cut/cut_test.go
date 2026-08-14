package mp4cut

import (
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Eyevinn/mp4ff/mp4"
)

// testdata/sample.mp4 は 320x180 / 30fps / GOP 60（キーフレームは 0,2,4,6,8 秒）の
// 10 秒クリップ。音声は 44.1kHz AAC。
const srcFile = "testdata/sample.mp4"

func TestCutSnapsToKeyframe(t *testing.T) {
	dst := filepath.Join(t.TempDir(), "out.mp4")

	// 3.0 秒はキーフレームではないので 2.0 秒に丸められる。
	res, err := Cut(srcFile, dst, 3.0, 7.0)
	if err != nil {
		t.Fatalf("Cut: %v", err)
	}
	if math.Abs(res.StartSec-2.0) > 0.05 {
		t.Errorf("StartSec = %.3f, want ~2.0 (直前のキーフレーム)", res.StartSec)
	}
	if math.Abs(res.EndSec-7.0) > 0.05 {
		t.Errorf("EndSec = %.3f, want ~7.0", res.EndSec)
	}

	fi, err := os.Stat(dst)
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if fi.Size() != res.Size {
		t.Errorf("実ファイルサイズ %d != Result.Size %d", fi.Size(), res.Size)
	}

	f := decodeFile(t, dst)
	video := trakByHandler(t, f, "vide")
	stbl := video.Mdia.Minf.Stbl

	if got := stbl.Stsz.GetNrSamples(); got != 150 {
		t.Errorf("映像サンプル数 = %d, want 150 (5秒 x 30fps)", got)
	}
	if len(stbl.Stss.SampleNumber) == 0 || stbl.Stss.SampleNumber[0] != 1 {
		t.Errorf("stss = %v, 先頭サンプルが同期サンプルであるべき", stbl.Stss.SampleNumber)
	}
	wantMediaDur := uint64(5 * video.Mdia.Mdhd.Timescale)
	if d := video.Mdia.Mdhd.Duration; absDiff(d, wantMediaDur) > uint64(video.Mdia.Mdhd.Timescale)/10 {
		t.Errorf("mdhd.Duration = %d, want ~%d", d, wantMediaDur)
	}
	if video.Edts != nil {
		t.Error("edts は破棄されるべき")
	}
}

func TestCutTablesAreConsistent(t *testing.T) {
	dst := filepath.Join(t.TempDir(), "out.mp4")
	if _, err := Cut(srcFile, dst, 1.5, 5.5); err != nil {
		t.Fatalf("Cut: %v", err)
	}
	f := decodeFile(t, dst)

	if len(f.Moov.Traks) != 2 {
		t.Fatalf("トラック数 = %d, want 2", len(f.Moov.Traks))
	}
	mdatStart := f.Mdat.PayloadAbsoluteOffset()
	mdatEnd := mdatStart + f.Mdat.DataLength()

	for _, trak := range f.Moov.Traks {
		stbl := trak.Mdia.Minf.Stbl
		n := stbl.Stsz.GetNrSamples()

		var sttsSamples uint32
		for _, c := range stbl.Stts.SampleCount {
			sttsSamples += c
		}
		if sttsSamples != n {
			t.Errorf("trak %d: stts のサンプル数 %d != stsz の %d", trak.Tkhd.TrackID, sttsSamples, n)
		}

		// 全チャンクのサンプル合計が stsz と一致し、各チャンクが mdat 内に収まること。
		chunks, err := stbl.Stsc.GetContainingChunks(1, n)
		if err != nil {
			t.Fatalf("trak %d: GetContainingChunks: %v", trak.Tkhd.TrackID, err)
		}
		var total uint32
		for _, c := range chunks {
			total += c.NrSamples
			off, err := chunkOffset(stbl, c.ChunkNr)
			if err != nil {
				t.Fatalf("trak %d: chunkOffset: %v", trak.Tkhd.TrackID, err)
			}
			size, err := stbl.Stsz.GetTotalSampleSize(c.StartSampleNr, c.StartSampleNr+c.NrSamples-1)
			if err != nil {
				t.Fatalf("trak %d: GetTotalSampleSize: %v", trak.Tkhd.TrackID, err)
			}
			if off < mdatStart || off+size > mdatEnd {
				t.Errorf("trak %d chunk %d: [%d,%d) が mdat [%d,%d) の外",
					trak.Tkhd.TrackID, c.ChunkNr, off, off+size, mdatStart, mdatEnd)
			}
		}
		if total != n {
			t.Errorf("trak %d: stsc のサンプル合計 %d != stsz の %d", trak.Tkhd.TrackID, total, n)
		}
	}
}

// TestCutDecodesWithoutError は出力を実際にデコードして壊れていないことを確かめる。
// ffmpeg が無い環境ではスキップする。
func TestCutDecodesWithoutError(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg が無いためスキップ")
	}
	dst := filepath.Join(t.TempDir(), "out.mp4")
	if _, err := Cut(srcFile, dst, 3.0, 7.0); err != nil {
		t.Fatalf("Cut: %v", err)
	}
	out, err := exec.Command(ffmpeg, "-v", "error", "-i", dst, "-f", "null", "-").CombinedOutput()
	if err != nil {
		t.Fatalf("ffmpeg デコード失敗: %v\n%s", err, out)
	}
	if s := strings.TrimSpace(string(out)); s != "" {
		t.Errorf("ffmpeg がエラーを出力: %s", s)
	}
}

func TestCutRejectsBadRange(t *testing.T) {
	dst := filepath.Join(t.TempDir(), "out.mp4")
	if _, err := Cut(srcFile, dst, 5.0, 5.0); err == nil {
		t.Error("開始 >= 終了 はエラーになるべき")
	}
	if _, err := os.Stat(dst); err == nil {
		t.Error("失敗時に出力ファイルを残すべきではない")
	}
}

func decodeFile(t *testing.T, path string) *mp4.File {
	t.Helper()
	fh, err := os.Open(path)
	if err != nil {
		t.Fatalf("Open %s: %v", path, err)
	}
	t.Cleanup(func() { fh.Close() })
	f, err := mp4.DecodeFile(fh)
	if err != nil {
		t.Fatalf("出力を再パースできません: %v", err)
	}
	return f
}

func trakByHandler(t *testing.T, f *mp4.File, handler string) *mp4.TrakBox {
	t.Helper()
	for _, trak := range f.Moov.Traks {
		if trak.Mdia.Hdlr.HandlerType == handler {
			return trak
		}
	}
	t.Fatalf("%s トラックが見つかりません", handler)
	return nil
}

func absDiff(a, b uint64) uint64 {
	if a > b {
		return a - b
	}
	return b - a
}
