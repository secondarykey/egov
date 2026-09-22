// Package animimage はアニメーション画像（WebP / GIF / APNG）を
// 合成済みのフレーム列へ展開する。
//
// WebView は <img> でならこれらを再生できるが、WebGL へ転送できるのは
// 先頭フレームだけで、シークも一時停止もできない。そこで Go 側で全フレームを
// キャンバスサイズの RGBA へ合成しておき、フロントエンドは1枚ずつ取り寄せて
// 動画と同じ操作系（シーク・コマ送り・ループ）で表示する。
//
// 形式ごとの差（フレームの位置・重ね方・表示後の消し方・表示時間の単位）は
// 各デコーダで frame へ揃え、合成は compose が一手に引き受ける。
package animimage

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"io"
	"os"
)

// MaxBytes は合成済みフレームの合計サイズの上限。
// フレームは非圧縮の RGBA で保持するので、長尺・高解像度の素材は
// メモリを食い潰す（1920x1080 で 600 フレームなら約 5GB）。
const MaxBytes = 1 << 30

// minFrameMs 以下の表示時間はブラウザと同じく defaultFrameMs として扱う。
// 0ms や 10ms のフレームを持つ素材は多く（GIF では特に）、そのまま再生すると
// Chrome/Firefox で見たときより極端に速くなる。
const (
	minFrameMs     = 10
	defaultFrameMs = 100
)

// ErrTooLarge は合成後のフレームが MaxBytes を超える場合に返る。
var ErrTooLarge = errors.New("animimage: animation is too large to expand in memory")

// ErrNotAnimated は1フレームしか無い素材に返る（静止画として扱うべきもの）。
// APNG はヘッダ（acTL）があってもフレームが1枚のことがある。
var ErrNotAnimated = errors.New("animimage: not animated")

// Animation は合成済みのアニメーション。
type Animation struct {
	Width, Height int
	// Frames は各フレームのキャンバス全体の画素（非乗算 RGBA、行詰め）。
	Frames [][]byte
	// DurationsMs は各フレームの表示時間（ミリ秒、補正済み）。
	DurationsMs []int
}

// disposal はフレームを表示し終えた後にその領域をどうするか。
type disposal int

const (
	disposeNone     disposal = iota // そのまま残す
	disposeClear                    // 透明に戻す（GIF の background / APNG の background / WebP の dispose）
	disposePrevious                 // このフレームを描く前の状態に戻す（GIF / APNG のみ）
)

// frame は形式に依らない1フレームの記述。
type frame struct {
	img     image.Image
	rect    image.Rectangle // キャンバス上の描画先
	blend   bool            // true: アルファ合成 / false: 領域を置き換え
	dispose disposal
	ms      int
}

// format は形式ごとの判定とデコード。
type format struct {
	name string
	// sniff はファイル先頭 sniffLen バイトで形式を判定する
	sniff func(head []byte) bool
	// animated は r（ファイル先頭から）がアニメーションかを軽く判定する
	animated func(r *bufio.Reader) bool
	// decode は全フレームとキャンバスサイズを返す
	decode func(r io.Reader) (w, h int, frames []frame, err error)
}

const sniffLen = 32

var formats = []format{webpFormat, gifFormat, apngFormat}

func sniff(head []byte) *format {
	for i := range formats {
		if formats[i].sniff(head) {
			return &formats[i]
		}
	}
	return nil
}

// IsAnimated は path がアニメーション画像かを、全体をデコードせずに判定する。
// 形式は拡張子ではなく中身で見る（.png の APNG や、拡張子違いの GIF があるため）。
func IsAnimated(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	br := bufio.NewReader(f)
	head, _ := br.Peek(sniffLen)
	ft := sniff(head)
	return ft != nil && ft.animated(br)
}

// Load は path のアニメーション画像をデコードし、全フレームを合成する。
func Load(path string) (*Animation, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return Decode(f)
}

// Decode は r のアニメーション画像をデコードし、全フレームを合成する。
// 1フレームしか無い素材はエラーにする（静止画として扱うべきもの）。
func Decode(r io.Reader) (*Animation, error) {
	br := bufio.NewReader(r)
	head, _ := br.Peek(sniffLen)
	ft := sniff(head)
	if ft == nil {
		return nil, errors.New("animimage: unsupported format")
	}
	w, h, frames, err := ft.decode(br)
	if err != nil {
		return nil, fmt.Errorf("animimage: %s: %w", ft.name, err)
	}
	if w <= 0 || h <= 0 {
		return nil, fmt.Errorf("animimage: %s: invalid canvas %dx%d", ft.name, w, h)
	}
	if len(frames) < 2 {
		return nil, ErrNotAnimated
	}
	if int64(w)*int64(h)*4*int64(len(frames)) > MaxBytes {
		return nil, ErrTooLarge
	}
	return compose(w, h, frames), nil
}

// compose はフレームを順にキャンバスへ重ね、各時点のキャンバス全体を複製して残す。
// 初期状態と「消す」は透明。GIF の背景色・WebP の BackgroundColor は仕様上ヒントで、
// ブラウザや libwebp の anim_decode も透明で扱うのでそれに倣う。
func compose(w, h int, frames []frame) *Animation {
	anim := &Animation{Width: w, Height: h}
	canvas := image.NewNRGBA(image.Rect(0, 0, w, h))
	var saved []byte
	for _, fr := range frames {
		rect := fr.rect.Intersect(canvas.Rect)
		if fr.dispose == disposePrevious {
			saved = append(saved[:0], canvas.Pix...)
		}
		op := draw.Src
		if fr.blend {
			op = draw.Over
		}
		draw.Draw(canvas, rect, fr.img, fr.img.Bounds().Min.Add(rect.Min.Sub(fr.rect.Min)), op)

		anim.Frames = append(anim.Frames, bytes.Clone(canvas.Pix))
		ms := fr.ms
		if ms <= minFrameMs {
			ms = defaultFrameMs
		}
		anim.DurationsMs = append(anim.DurationsMs, ms)

		switch fr.dispose {
		case disposeClear:
			draw.Draw(canvas, rect, image.Transparent, image.Point{}, draw.Src)
		case disposePrevious:
			copy(canvas.Pix, saved)
		}
	}
	return anim
}
