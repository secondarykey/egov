package animimage

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"image"
	"image/gif"
	"io"
	"math"

	"github.com/kettek/apng"
	"golang.org/x/image/webp"
)

// --- WebP ---------------------------------------------------------------
// デコードは golang.org/x/image の fork（webp.DecodeAnimated）。

var webpFormat = format{
	name: "webp",
	sniff: func(h []byte) bool {
		return len(h) >= 12 && bytes.Equal(h[0:4], []byte("RIFF")) && bytes.Equal(h[8:12], []byte("WEBP"))
	},
	// 拡張 WebP（VP8X）の flags のビット1（0x02）がアニメーション
	animated: func(r *bufio.Reader) bool {
		h, err := r.Peek(21)
		return err == nil && bytes.Equal(h[12:16], []byte("VP8X")) && h[20]&0x02 != 0
	},
	decode: func(r io.Reader) (int, int, []frame, error) {
		awp, err := webp.DecodeAnimated(r)
		if err != nil {
			return 0, 0, nil, err
		}
		frames := make([]frame, 0, len(awp.Frames))
		for _, f := range awp.Frames {
			d := disposeNone
			if f.Dispose {
				d = disposeClear
			}
			frames = append(frames, frame{
				img:     f.Image,
				rect:    image.Rect(f.OffsetX, f.OffsetY, f.OffsetX+f.Width, f.OffsetY+f.Height),
				blend:   f.Blend,
				dispose: d,
				ms:      f.Duration,
			})
		}
		return awp.Config.Width, awp.Config.Height, frames, nil
	},
}

// --- GIF ----------------------------------------------------------------
// 標準ライブラリの image/gif。透過色はパレット上でアルファ0なので常にアルファ合成でよい。

var gifFormat = format{
	name: "gif",
	sniff: func(h []byte) bool {
		return bytes.HasPrefix(h, []byte("GIF87a")) || bytes.HasPrefix(h, []byte("GIF89a"))
	},
	animated: gifHasMultipleImages,
	decode: func(r io.Reader) (int, int, []frame, error) {
		g, err := gif.DecodeAll(r)
		if err != nil {
			return 0, 0, nil, err
		}
		w, h := g.Config.Width, g.Config.Height
		frames := make([]frame, 0, len(g.Image))
		for i, img := range g.Image {
			d := disposeNone
			if i < len(g.Disposal) {
				switch g.Disposal[i] {
				case gif.DisposalBackground:
					d = disposeClear
				case gif.DisposalPrevious:
					d = disposePrevious
				}
			}
			frames = append(frames, frame{
				img:     img,
				rect:    img.Bounds(),
				blend:   true,
				dispose: d,
				ms:      g.Delay[i] * 10, // 1/100 秒単位
			})
		}
		return w, h, frames, nil
	},
}

// gifHasMultipleImages はブロックを読み飛ばしながら画像記述子（0x2C）を数え、
// 2つ目が見つかった時点で true を返す。画素（LZW）は展開しない。
func gifHasMultipleImages(r *bufio.Reader) bool {
	var hdr [13]byte // シグネチャ(6) + 論理画面記述子(7)
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return false
	}
	if !skipColorTable(r, hdr[10]) {
		return false
	}
	images := 0
	for {
		b, err := r.ReadByte()
		if err != nil {
			return false
		}
		switch b {
		case 0x21: // 拡張ブロック: ラベル + サブブロック列
			if _, err := r.ReadByte(); err != nil || !skipSubBlocks(r) {
				return false
			}
		case 0x2C: // 画像記述子
			images++
			if images >= 2 {
				return true
			}
			var desc [9]byte
			if _, err := io.ReadFull(r, desc[:]); err != nil || !skipColorTable(r, desc[8]) {
				return false
			}
			if _, err := r.ReadByte(); err != nil || !skipSubBlocks(r) { // LZW 最小符号長 + データ
				return false
			}
		default: // 0x3B（終端）や壊れたデータ
			return false
		}
	}
}

// skipColorTable は flags の最上位ビットが立っていれば色テーブルを読み飛ばす。
func skipColorTable(r *bufio.Reader, flags byte) bool {
	if flags&0x80 == 0 {
		return true
	}
	_, err := r.Discard(3 * (1 << (int(flags&0x07) + 1)))
	return err == nil
}

func skipSubBlocks(r *bufio.Reader) bool {
	for {
		n, err := r.ReadByte()
		if err != nil {
			return false
		}
		if n == 0 {
			return true
		}
		if _, err := r.Discard(int(n)); err != nil {
			return false
		}
	}
}

// --- APNG ---------------------------------------------------------------
// github.com/kettek/apng（Go 標準の image/png に APNG を足したもの）。

var pngSignature = []byte("\x89PNG\r\n\x1a\n")

var apngFormat = format{
	name:  "apng",
	sniff: func(h []byte) bool { return bytes.HasPrefix(h, pngSignature) },
	// acTL チャンクが IDAT より前にあれば APNG（仕様上 acTL は IDAT の前に置く）
	animated: func(r *bufio.Reader) bool {
		if _, err := r.Discard(len(pngSignature)); err != nil {
			return false
		}
		var ch [8]byte // 長さ(4) + 種類(4)
		for {
			if _, err := io.ReadFull(r, ch[:]); err != nil {
				return false
			}
			switch string(ch[4:8]) {
			case "acTL":
				return true
			case "IDAT", "IEND":
				return false
			}
			if _, err := r.Discard(int(binary.BigEndian.Uint32(ch[0:4])) + 4); err != nil { // データ + CRC
				return false
			}
		}
	},
	decode: func(r io.Reader) (int, int, []frame, error) {
		a, err := apng.DecodeAll(r)
		if err != nil {
			return 0, 0, nil, err
		}
		if len(a.Frames) == 0 {
			return 0, 0, nil, nil
		}
		// 先頭（既定画像か第1フレーム）は IHDR のサイズ＝キャンバスサイズ
		canvas := a.Frames[0].Image.Bounds()
		frames := make([]frame, 0, len(a.Frames))
		for _, f := range a.Frames {
			// 既定画像（IDAT だが fcTL が無い）はアニメーションに含めない
			if f.IsDefault {
				continue
			}
			d := disposeNone
			switch f.DisposeOp {
			case apng.DISPOSE_OP_BACKGROUND:
				d = disposeClear
			case apng.DISPOSE_OP_PREVIOUS:
				// 仕様: 最初のフレームの PREVIOUS は BACKGROUND として扱う
				d = disposePrevious
				if len(frames) == 0 {
					d = disposeClear
				}
			}
			b := f.Image.Bounds()
			frames = append(frames, frame{
				img:     f.Image,
				rect:    image.Rect(f.XOffset, f.YOffset, f.XOffset+b.Dx(), f.YOffset+b.Dy()),
				blend:   f.BlendOp == apng.BLEND_OP_OVER,
				dispose: d,
				ms:      int(math.Round(f.GetDelay() * 1000)),
			})
		}
		return canvas.Dx(), canvas.Dy(), frames, nil
	},
}
