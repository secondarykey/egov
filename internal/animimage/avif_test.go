package animimage

import (
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
