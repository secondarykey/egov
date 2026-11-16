package egov

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestFileHandlerAccess(t *testing.T) {
	dir := t.TempDir()
	allowed := filepath.Join(dir, "a.mp4")
	other := filepath.Join(dir, "b.mp4")
	for _, p := range []string{allowed, other} {
		if err := os.WriteFile(p, []byte("data"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	files := NewLocalFiles(1234, "tok")
	files.Allow(allowed)
	h := NewFileHandler(files, NewAnimStore())

	get := func(target string) int {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", target, nil))
		return rec.Code
	}
	q := func(token, path string) string {
		return "/localfile?" + url.Values{"token": {token}, "path": {path}}.Encode()
	}

	cases := []struct {
		name   string
		target string
		want   int
	}{
		{"許可済み", q("tok", allowed), http.StatusOK},
		{"トークン違い", q("bad", allowed), http.StatusForbidden},
		{"許可リスト外", q("tok", other), http.StatusForbidden},
		{"フレームもトークンが要る", "/animframe?id=1&i=0", http.StatusForbidden},
		{"開いていないアニメーション", "/animframe?token=tok&id=1&i=0", http.StatusGone},
		{"不正なロケールコード", "/languages/..%2Fsettings.json", http.StatusNotFound},
	}
	for _, c := range cases {
		if got := get(c.target); got != c.want {
			t.Errorf("%s: %s = %d, want %d", c.name, c.target, got, c.want)
		}
	}
}

func TestFileHandlerCORS(t *testing.T) {
	h := NewFileHandler(NewLocalFiles(1234, "tok"), NewAnimStore())
	for origin, want := range map[string]bool{
		"http://wails.localhost:9245": true,
		"wails://wails.localhost":     true,
		"http://localhost:5173":       true,
		"https://evil.com":            false,
		"":                            false,
	} {
		rec := httptest.NewRecorder()
		r := httptest.NewRequest("GET", "/localfile", nil)
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		h.ServeHTTP(rec, r)
		if got := rec.Header().Get("Access-Control-Allow-Origin") == origin && origin != ""; got != want {
			t.Errorf("Origin %q reflected = %v, want %v", origin, got, want)
		}
	}
}
