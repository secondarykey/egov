// Package animwebp はアニメーション WebP を合成済みのフレーム列へ展開する。
//
// WebView は <img> でならアニメーション WebP を再生できるが、WebGL へ転送できるのは
// 先頭フレームだけで、シークも一時停止もできない。そこで Go 側で全フレームを
// キャンバスサイズの RGBA へ合成しておき、フロントエンドは1枚ずつ取り寄せて
// 動画と同じ操作系（シーク・コマ送り・ループ）で表示する。
//
// デコードは golang.org/x/image/webp の fork（DecodeAnimated）を使う。
package animwebp

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"io"
	"os"

	"golang.org/x/image/webp"
)

// MaxBytes は合成済みフレームの合計サイズの上限。
// フレームは非圧縮の RGBA で保持するので、長尺・高解像度の素材は
// メモリを食い潰す（1920x1080 で 600 フレームなら約 5GB）。
const MaxBytes = 1 << 30

// minFrameMs 以下の表示時間はブラウザと同じく defaultFrameMs として扱う。
// 0ms や 10ms のフレームを持つ素材は多く、そのまま再生すると
// Chrome/Firefox で見たときより極端に速くなる。
const (
	minFrameMs     = 10
	defaultFrameMs = 100
)

// ErrTooLarge は合成後のフレームが MaxBytes を超える場合に返る。
var ErrTooLarge = errors.New("animwebp: animation is too large to expand in memory")

// Animation は合成済みのアニメーション。
type Animation struct {
	Width, Height int
	// Frames は各フレームのキャンバス全体の画素（非乗算 RGBA、行詰め）。
	Frames [][]byte
	// DurationsMs は各フレームの表示時間（ミリ秒、補正済み）。
	DurationsMs []int
}

// IsAnimated は path がアニメーション WebP かをヘッダだけで判定する。
// 拡張 WebP（VP8X）のアニメーションフラグを見るので、全体はデコードしない。
func IsAnimated(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	var h [21]byte
	if _, err := io.ReadFull(f, h[:]); err != nil {
		return false
	}
	return isAnimatedHeader(h[:])
}

// isAnimatedHeader: "RIFF" size "WEBP" "VP8X" size flags...
// flags のビット1（0x02）がアニメーション。
func isAnimatedHeader(h []byte) bool {
	return len(h) >= 21 &&
		bytes.Equal(h[0:4], []byte("RIFF")) &&
		bytes.Equal(h[8:12], []byte("WEBP")) &&
		bytes.Equal(h[12:16], []byte("VP8X")) &&
		h[20]&0x02 != 0
}

// Load は path のアニメーション WebP をデコードし、全フレームを合成する。
func Load(path string) (*Animation, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return Decode(f)
}

// Decode は r のアニメーション WebP をデコードし、全フレームを合成する。
func Decode(r io.Reader) (*Animation, error) {
	awp, err := webp.DecodeAnimated(r)
	if err != nil {
		return nil, err
	}
	w, h := awp.Config.Width, awp.Config.Height
	if w <= 0 || h <= 0 || len(awp.Frames) == 0 {
		return nil, fmt.Errorf("animwebp: empty animation (%dx%d, %d frames)", w, h, len(awp.Frames))
	}
	if int64(w)*int64(h)*4*int64(len(awp.Frames)) > MaxBytes {
		return nil, ErrTooLarge
	}

	anim := &Animation{Width: w, Height: h}
	// 合成はフレームの順に1枚のキャンバスへ重ねていく。
	// 背景色（ANIM の BackgroundColor）は仕様上ヒントにすぎず、
	// libwebp の anim_decode もブラウザも透明で初期化・破棄するのでそれに倣う。
	canvas := image.NewNRGBA(image.Rect(0, 0, w, h))
	for _, fr := range awp.Frames {
		rect := image.Rect(fr.OffsetX, fr.OffsetY, fr.OffsetX+fr.Width, fr.OffsetY+fr.Height).Intersect(canvas.Rect)
		op := draw.Src
		if fr.Blend {
			op = draw.Over
		}
		draw.Draw(canvas, rect, fr.Image, fr.Image.Bounds().Min, op)

		pix := make([]byte, len(canvas.Pix))
		copy(pix, canvas.Pix)
		anim.Frames = append(anim.Frames, pix)

		ms := fr.Duration
		if ms <= minFrameMs {
			ms = defaultFrameMs
		}
		anim.DurationsMs = append(anim.DurationsMs, ms)

		// Dispose は「このフレームを表示し終えたら、その領域を透明に戻す」
		if fr.Dispose {
			draw.Draw(canvas, rect, image.Transparent, image.Point{}, draw.Src)
		}
	}
	return anim, nil
}
