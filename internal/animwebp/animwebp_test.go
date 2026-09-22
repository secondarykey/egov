package animwebp

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// testdata は ffmpeg で生成した合成クリップ（testsrc2 64x48 / 10fps / 6 フレーム）。
// anim_expected.rgba が正解画素（rawvideo rgba）で、各 webp はこれを入力にエンコードした。
// libwebp_anim は2枚目以降を差分矩形＋ブレンドで格納するので、
// 可逆版が一致すれば合成（オフセット・ブレンド・破棄）が正しいと言える。

func TestIsAnimated(t *testing.T) {
	tests := []struct {
		file string
		want bool
	}{
		{"anim_lossless.webp", true},
		{"anim_lossy.webp", true},
		{"still.webp", false},
		{"missing.webp", false},
	}
	for _, tt := range tests {
		if got := IsAnimated(filepath.Join("testdata", tt.file)); got != tt.want {
			t.Errorf("IsAnimated(%s) = %v, want %v", tt.file, got, tt.want)
		}
	}
}

func TestLoadLossless(t *testing.T) {
	anim, err := Load(filepath.Join("testdata", "anim_lossless.webp"))
	if err != nil {
		t.Fatal(err)
	}
	if anim.Width != 64 || anim.Height != 48 {
		t.Fatalf("size = %dx%d, want 64x48", anim.Width, anim.Height)
	}
	if len(anim.Frames) != 6 {
		t.Fatalf("frames = %d, want 6", len(anim.Frames))
	}
	for i, ms := range anim.DurationsMs {
		if ms != 100 {
			t.Errorf("frame %d duration = %dms, want 100", i, ms)
		}
	}

	want, err := os.ReadFile(filepath.Join("testdata", "anim_expected.rgba"))
	if err != nil {
		t.Fatal(err)
	}
	size := 64 * 48 * 4
	for i, got := range anim.Frames {
		if len(got) != size {
			t.Fatalf("frame %d bytes = %d, want %d", i, len(got), size)
		}
		if !bytes.Equal(got, want[i*size:(i+1)*size]) {
			t.Errorf("frame %d pixels differ from reference", i)
		}
	}
}

func TestLoadLossy(t *testing.T) {
	anim, err := Load(filepath.Join("testdata", "anim_lossy.webp"))
	if err != nil {
		t.Fatal(err)
	}
	if len(anim.Frames) != 6 || anim.Width != 64 || anim.Height != 48 {
		t.Fatalf("got %dx%d %d frames", anim.Width, anim.Height, len(anim.Frames))
	}
	// 非可逆なので画素一致は見ない。不透明で埋まっていることだけ確かめる
	for i, f := range anim.Frames {
		for p := 3; p < len(f); p += 4 {
			if f[p] != 0xff {
				t.Fatalf("frame %d has non-opaque pixel at %d", i, p/4)
			}
		}
	}
}

func TestLoadStillIsError(t *testing.T) {
	if _, err := Load(filepath.Join("testdata", "still.webp")); err == nil {
		t.Fatal("expected error for non-animated WebP")
	}
}
