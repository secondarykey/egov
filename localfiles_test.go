package egov

import (
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenLocalFile(t *testing.T) {
	dir := t.TempDir()
	video := filepath.Join(dir, "movie.MP4")
	text := filepath.Join(dir, "note.txt")
	for _, p := range []string{video, text} {
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	files := NewLocalFiles(1234, "tok")
	a := NewApi("", files, nil, "", NewAnimStore())

	u, err := a.OpenLocalFile(video)
	if err != nil {
		t.Fatal(err)
	}
	if !files.IsAllowed(video) {
		t.Error("opened file is not allowed")
	}
	parsed, _ := url.Parse(u)
	if got := parsed.Query().Get("path"); got != video {
		t.Errorf("url path = %q, want %q", got, video)
	}

	for name, p := range map[string]string{
		"未対応の拡張子": text,
		"存在しない":   filepath.Join(dir, "none.mp4"),
		"ディレクトリ":  dir,
		"相対パス":    "movie.mp4",
	} {
		if _, err := a.OpenLocalFile(p); err == nil {
			t.Errorf("%s: expected error for %q", name, p)
		}
		if files.IsAllowed(p) {
			t.Errorf("%s: %q must not be allowed", name, p)
		}
	}
}

func TestLocalFilesAuthorized(t *testing.T) {
	files := NewLocalFiles(1234, "tok")
	for q, want := range map[string]bool{"token=tok": true, "token=bad": false, "": false} {
		r := httptest.NewRequest("GET", "/localfile?"+q, nil)
		if got := files.Authorized(r); got != want {
			t.Errorf("Authorized(%q) = %v, want %v", q, got, want)
		}
	}
}

func TestMediaFilePattern(t *testing.T) {
	p := (&API{}).MediaFilePattern()
	for _, ext := range []string{"*.mp4", "*.mkv", "*.png", "*.webp", "*.avif", "*.apng"} {
		if !strings.Contains(p, ext) {
			t.Errorf("pattern lacks %s: %s", ext, p)
		}
	}
}
