package animimage

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"os"
)

// IsAVIFSequence は path がアニメーション AVIF（AVIF 画像シーケンス）かを判定する。
//
// AVIF シーケンスの中身は ISOBMFF の moov/trak（ハンドラ 'pict'）＋ AV1 サンプルで、
// MP4 と同じ構造をしている。Chromium（WebView2）の <video> はこれを動画として
// 再生できるので、フレームを Go で展開する WebP / GIF / APNG と違い、動画と同じ経路へ流す。
// ただしそのままでは再生できない。配信時の加工は OpenAVIFForVideo を参照。
//
// 判定は ftyp のブランドだけで行う。'avis' はシーケンスを含むことを示すブランドで、
// 静止画だけの AVIF は 'avif' しか持たない。
func IsAVIFSequence(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	return isAVIFSequence(f)
}

func isAVIFSequence(r io.Reader) bool {
	var hdr [8]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return false
	}
	size := binary.BigEndian.Uint32(hdr[0:4])
	// ftyp は major(4) + minor(4) + compatible(4*n)。巨大な値は壊れたファイルとみなす
	if string(hdr[4:8]) != "ftyp" || size < 16 || size > 1024 {
		return false
	}
	body := make([]byte, size-8)
	if _, err := io.ReadFull(r, body); err != nil {
		return false
	}
	avis := []byte("avis")
	if bytes.Equal(body[0:4], avis) {
		return true
	}
	for i := 8; i+4 <= len(body); i += 4 {
		if bytes.Equal(body[i:i+4], avis) {
			return true
		}
	}
	return false
}

// AVIFVideo は AVIF シーケンスを video 要素向けに読ませる io.ReadSeeker。
//
// AVIF シーケンスはトップレベルの meta に「静止画としての代表画像」（1フレーム）を
// 持っている。Chromium のデマクサ（FFmpeg）はこれを moov のトラックより前の
// 映像ストリームとして見せ、video 要素はその1フレームしかない方を選ぶため、
// 読み込み直後に末尾まで飛んで ended になる（WebView2 153 で確認）。
//
// meta の box type を同じ長さの 'free' に読み替えて見せれば代表画像のストリームが消え、
// moov のトラックが選ばれる。サイズが変わらないので stco のオフセットは直さなくてよい。
// ファイル自体は書き換えず、読み出し時に4バイトだけ差し替える。
type AVIFVideo struct {
	f        *os.File
	pos      int64
	patchOff int64 // 'meta' の4文字の位置（-1 なら差し替えなし）
}

// OpenAVIFForVideo は path を開き、トップレベルの meta を無効化して読ませる。
func OpenAVIFForVideo(path string) (*AVIFVideo, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	off, err := topLevelBoxType(f, "meta")
	if err != nil {
		f.Close()
		return nil, err
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		f.Close()
		return nil, err
	}
	return &AVIFVideo{f: f, patchOff: off}, nil
}

var freeType = []byte("free")

func (a *AVIFVideo) Read(p []byte) (int, error) {
	n, err := a.f.Read(p)
	if a.patchOff >= 0 && n > 0 {
		// 読んだ範囲 [pos, pos+n) と差し替え範囲 [patchOff, patchOff+4) の重なりを上書き
		for i := int64(0); i < 4; i++ {
			if at := a.patchOff + i - a.pos; at >= 0 && at < int64(n) {
				p[at] = freeType[i]
			}
		}
	}
	a.pos += int64(n)
	return n, err
}

func (a *AVIFVideo) Seek(offset int64, whence int) (int64, error) {
	pos, err := a.f.Seek(offset, whence)
	if err == nil {
		a.pos = pos
	}
	return pos, err
}

func (a *AVIFVideo) Close() error { return a.f.Close() }

// Stat は http.ServeContent に渡す更新時刻を取るために使う。
func (a *AVIFVideo) Stat() (os.FileInfo, error) { return a.f.Stat() }

// topLevelBoxType はトップレベルの box を順に辿り、typ の box type（4文字）の
// ファイル内位置を返す。見つからなければ -1。mdat などの中身は読まない。
func topLevelBoxType(r io.ReadSeeker, typ string) (int64, error) {
	var off int64
	var hdr [16]byte
	for {
		if _, err := r.Seek(off, io.SeekStart); err != nil {
			return -1, err
		}
		if _, err := io.ReadFull(r, hdr[:8]); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				return -1, nil
			}
			return -1, err
		}
		if string(hdr[4:8]) == typ {
			return off + 4, nil
		}
		size := int64(binary.BigEndian.Uint32(hdr[0:4]))
		switch size {
		case 0: // ファイル末尾まで
			return -1, nil
		case 1: // 64bit の largesize
			if _, err := io.ReadFull(r, hdr[8:16]); err != nil {
				return -1, err
			}
			size = int64(binary.BigEndian.Uint64(hdr[8:16]))
		}
		if size < 8 {
			return -1, errors.New("animimage: broken box size")
		}
		off += size
	}
}
