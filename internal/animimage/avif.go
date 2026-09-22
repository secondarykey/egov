package animimage

import (
	"bytes"
	"encoding/binary"
	"io"
	"os"
)

// IsAVIFSequence は path がアニメーション AVIF（AVIF 画像シーケンス）かを判定する。
//
// AVIF シーケンスの中身は ISOBMFF の moov/trak（ハンドラ 'pict'）＋ AV1 サンプルで、
// MP4 と同じ構造をしている。Chromium（WebView2）の <video> はこれをそのまま
// 動画として再生できる（ヘッドレスの Chrome / Edge で確認済み）ので、
// フレームを Go で展開する WebP / GIF / APNG と違い、動画と同じ経路へ流す。
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
