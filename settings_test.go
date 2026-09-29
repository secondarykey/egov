package egov

import "testing"

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
