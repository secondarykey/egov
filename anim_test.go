package egov

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestAnimStoreServeFrame(t *testing.T) {
	s := NewAnimStore()
	info, err := s.open(filepath.Join("internal", "animimage", "testdata", "anim_lossless.webp"))
	if err != nil {
		t.Fatal(err)
	}
	if !info.Animated || info.Width != 64 || info.Height != 48 || len(info.DurationsMs) != 6 {
		t.Fatalf("info = %+v", info)
	}

	get := func(query string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		s.ServeFrame(rec, httptest.NewRequest("GET", "/animframe?"+query, nil))
		return rec
	}
	if rec := get("id=1&i=0"); rec.Code != http.StatusOK || rec.Body.Len() != 64*48*4 {
		t.Errorf("frame 0: code=%d len=%d", rec.Code, rec.Body.Len())
	}
	if rec := get("id=1&i=6"); rec.Code != http.StatusNotFound {
		t.Errorf("out of range: code=%d", rec.Code)
	}
	if rec := get("id=0&i=0"); rec.Code != http.StatusGone {
		t.Errorf("stale id: code=%d", rec.Code)
	}
	if rec := get("i=0"); rec.Code != http.StatusBadRequest {
		t.Errorf("missing id: code=%d", rec.Code)
	}

	// 静止画の WebP は Animated=false で、保持していたフレームも解放する
	info, err = s.open(filepath.Join("internal", "animimage", "testdata", "still.webp"))
	if err != nil || info.Animated {
		t.Fatalf("still: info=%+v err=%v", info, err)
	}
	if rec := get("id=1&i=0"); rec.Code != http.StatusGone {
		t.Errorf("after close: code=%d", rec.Code)
	}
}
