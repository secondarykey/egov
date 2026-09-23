package animimage

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestIsAVIFSequence(t *testing.T) {
	tests := []struct {
		file string
		want bool
	}{
		{"anim.avif", true},
		{"still.avif", false},
		{"anim.apng", false},
		{"anim_lossless.webp", false},
		{"missing.avif", false},
	}
	for _, tt := range tests {
		if got := IsAVIFSequence(filepath.Join("testdata", tt.file)); got != tt.want {
			t.Errorf("IsAVIFSequence(%s) = %v, want %v", tt.file, got, tt.want)
		}
	}
}

func TestAVIFVideoHidesMeta(t *testing.T) {
	path := filepath.Join("testdata", "anim.avif")
	orig, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	metaAt := bytes.Index(orig, []byte("meta"))
	if metaAt < 0 {
		t.Fatal("testdata has no meta box")
	}
	want := bytes.Clone(orig)
	copy(want[metaAt:], "free")

	a, err := OpenAVIFForVideo(path)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	got, err := io.ReadAll(a)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("full read: meta was not replaced with free (or other bytes changed)")
	}

	// Range 要求のように、差し替え位置をまたぐ細切れの読み出しでも同じになること
	for start := int64(metaAt - 3); start <= int64(metaAt+3); start++ {
		if _, err := a.Seek(start, io.SeekStart); err != nil {
			t.Fatal(err)
		}
		buf := make([]byte, 5)
		n, err := io.ReadFull(a, buf)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(buf[:n], want[start:start+int64(n)]) {
			t.Errorf("read at %d = %q, want %q", start, buf[:n], want[start:start+int64(n)])
		}
	}
	// トップレベル以外（moov/trak 内）の hdlr などは触らない
	if bytes.Count(got, []byte("pict")) != bytes.Count(orig, []byte("pict")) {
		t.Error("non-top-level boxes changed")
	}
}
