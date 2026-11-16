package egov

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeSourceFOV(t *testing.T) {
	cases := []struct {
		proj string
		in   float64
		want float64
	}{
		{"equirect", 360, 360}, // 360°モノラル
		{"equirect", 400, 180},
		{"flat", 70, 70},
		{"flat", 180, 70}, // flat は 180° 未満でなければ tan が発散する
		{"equisolid", 90, 180},
	}
	for _, c := range cases {
		s := defaultSettings()
		s.VR.SourceProjection = c.proj
		s.VR.SourceFOV = c.in
		s.normalize()
		if s.VR.SourceFOV != c.want {
			t.Errorf("%s %v: got %v, want %v", c.proj, c.in, s.VR.SourceFOV, c.want)
		}
	}
}

func TestNormalizeDefaultStartFull(t *testing.T) {
	s := defaultSettings()
	s.VR.DefaultStart = "full"
	s.normalize()
	if s.VR.DefaultStart != "full" {
		t.Errorf("got %q, want full", s.VR.DefaultStart)
	}
}

func TestNormalizeZoomInsetFeather(t *testing.T) {
	cases := []struct{ in, want float64 }{
		{0, 0}, // 0 は「縁を透かさない」として有効
		{0.12, 0.12},
		{-0.1, 0},
		{1, zoomFeatherMax},
	}
	for _, c := range cases {
		s := defaultSettings()
		s.ZoomInset.Feather = c.in
		s.normalize()
		if s.ZoomInset.Feather != c.want {
			t.Errorf("%v: got %v, want %v", c.in, s.ZoomInset.Feather, c.want)
		}
	}
}

// どの経路の更新でも正規化を通してから保存する（次回起動を待たない）。
func TestSettingsStoreUpdateNormalizes(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	if err := os.MkdirAll(filepath.Join(home, ".egov"), 0o755); err != nil {
		t.Fatal(err)
	}

	a := NewApi("", nil, NewSettingsStore(defaultSettings()), "", nil)
	vr := defaultSettings().VR
	vr.FOV = 0
	vr.ShiftX = 99
	a.UpdateVRSettings(vr)
	a.UpdateControlSettings(ControlSettings{})

	got := a.GetSettings()
	if got.VR.FOV != defaultSettings().VR.FOV {
		t.Errorf("FOV = %v, want default", got.VR.FOV)
	}
	if got.VR.ShiftX != vrShiftLimit {
		t.Errorf("ShiftX = %v, want %v", got.VR.ShiftX, vrShiftLimit)
	}
	if got.Controls.ClickTimeoutMs != defaultSettings().Controls.ClickTimeoutMs {
		t.Errorf("ClickTimeoutMs = %v, want default", got.Controls.ClickTimeoutMs)
	}

	// ディスクにも正規化後の値が書かれている
	loaded, err := LoadSettings()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.VR.FOV != got.VR.FOV || loaded.VR.ShiftX != got.VR.ShiftX {
		t.Errorf("saved VR = %+v, want %+v", loaded.VR, got.VR)
	}
}
