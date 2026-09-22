package animimage

import (
	"bytes"
	"image"
	"image/color"
	"image/gif"
	"testing"

	"github.com/kettek/apng"
)

// 4x1 のキャンバスで破棄・合成の各方式を確かめる。
// 各フレームの期待値は「そのフレームを表示した時点」のキャンバス。
var (
	cT = color.NRGBA{}                 // 透明
	cR = color.NRGBA{0xff, 0, 0, 0xff} // 赤
	cG = color.NRGBA{0, 0xff, 0, 0xff} // 緑
	cB = color.NRGBA{0, 0, 0xff, 0xff} // 青
)

func pixels(cs ...color.NRGBA) []byte {
	var b []byte
	for _, c := range cs {
		b = append(b, c.R, c.G, c.B, c.A)
	}
	return b
}

func checkFrames(t *testing.T, anim *Animation, want [][]byte) {
	t.Helper()
	if len(anim.Frames) != len(want) {
		t.Fatalf("frames = %d, want %d", len(anim.Frames), len(want))
	}
	for i := range want {
		if !bytes.Equal(anim.Frames[i], want[i]) {
			t.Errorf("frame %d = %v, want %v", i, anim.Frames[i], want[i])
		}
	}
}

func TestGIFDisposal(t *testing.T) {
	pal := color.Palette{color.Transparent, color.RGBA{0xff, 0, 0, 0xff}, color.RGBA{0, 0xff, 0, 0xff}, color.RGBA{0, 0, 0xff, 0xff}}
	fill := func(r image.Rectangle, idx uint8) *image.Paletted {
		p := image.NewPaletted(r, pal)
		for i := range p.Pix {
			p.Pix[i] = idx
		}
		return p
	}
	g := &gif.GIF{
		Image: []*image.Paletted{
			fill(image.Rect(0, 0, 4, 1), 1), // 全面赤
			fill(image.Rect(1, 0, 2, 1), 2), // 1 に緑 → 表示後に直前へ戻す
			fill(image.Rect(2, 0, 3, 1), 3), // 2 に青 → 表示後に透明へ
			fill(image.Rect(0, 0, 1, 1), 0), // 0 に透明色 → 下が透けて赤のまま
		},
		Delay:    []int{5, 0, 1, 20},
		Disposal: []byte{gif.DisposalNone, gif.DisposalPrevious, gif.DisposalBackground, gif.DisposalNone},
		Config:   image.Config{ColorModel: pal, Width: 4, Height: 1},
	}
	var buf bytes.Buffer
	if err := gif.EncodeAll(&buf, g); err != nil {
		t.Fatal(err)
	}
	anim, err := Decode(&buf)
	if err != nil {
		t.Fatal(err)
	}
	checkFrames(t, anim, [][]byte{
		pixels(cR, cR, cR, cR),
		pixels(cR, cG, cR, cR),
		pixels(cR, cR, cB, cR), // 緑は直前（全面赤）へ戻っている
		pixels(cR, cR, cT, cR), // 青は透明へ消え、透明色の重ねは何も変えない
	})
	// 1/100秒単位。10ms 以下はブラウザと同じく 100ms
	wantMs := []int{50, 100, 100, 200}
	for i, ms := range anim.DurationsMs {
		if ms != wantMs[i] {
			t.Errorf("frame %d duration = %d, want %d", i, ms, wantMs[i])
		}
	}
}

func TestAPNGBlendAndDisposal(t *testing.T) {
	fill := func(w int, c color.NRGBA) *image.NRGBA {
		img := image.NewNRGBA(image.Rect(0, 0, w, 1))
		for x := 0; x < w; x++ {
			img.SetNRGBA(x, 0, c)
		}
		return img
	}
	a := apng.APNG{Frames: []apng.Frame{
		{Image: fill(4, cR), DelayNumerator: 1, DelayDenominator: 10},
		// 1 に緑、表示後に直前へ戻す
		{Image: fill(1, cG), XOffset: 1, DelayNumerator: 1, DelayDenominator: 10, DisposeOp: apng.DISPOSE_OP_PREVIOUS, BlendOp: apng.BLEND_OP_OVER},
		// 2 を透明で「置き換え」（SOURCE）、表示後に透明へ
		{Image: fill(1, cT), XOffset: 2, DelayNumerator: 1, DelayDenominator: 10, DisposeOp: apng.DISPOSE_OP_BACKGROUND, BlendOp: apng.BLEND_OP_SOURCE},
		// 3 に透明を「重ね」（OVER）→ 赤のまま
		{Image: fill(1, cT), XOffset: 3, DelayNumerator: 1, DelayDenominator: 10, BlendOp: apng.BLEND_OP_OVER},
	}}
	var buf bytes.Buffer
	if err := apng.Encode(&buf, a); err != nil {
		t.Fatal(err)
	}
	anim, err := Decode(&buf)
	if err != nil {
		t.Fatal(err)
	}
	checkFrames(t, anim, [][]byte{
		pixels(cR, cR, cR, cR),
		pixels(cR, cG, cR, cR),
		pixels(cR, cR, cT, cR),
		pixels(cR, cR, cT, cR),
	})
	for i, ms := range anim.DurationsMs {
		if ms != 100 {
			t.Errorf("frame %d duration = %d, want 100", i, ms)
		}
	}
}
