package vrformat

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

func mk(typ string, parts ...[]byte) []byte {
	var body []byte
	for _, p := range parts {
		body = append(body, p...)
	}
	out := make([]byte, 8, 8+len(body))
	binary.BigEndian.PutUint32(out, uint32(8+len(body)))
	copy(out[4:], typ)
	return append(out, body...)
}

func u32(v uint32) []byte { b := make([]byte, 4); binary.BigEndian.PutUint32(b, v); return b }

// writeMP4 は映像トラック1本の最小限の MP4 を書く。ext はサンプルエントリの子box。
func writeMP4(t *testing.T, name string, ext []byte, trakExtra []byte) string {
	t.Helper()
	hdlr := mk("hdlr", u32(0), u32(0), []byte("vide"), make([]byte, 12), []byte{0})
	entry := mk("avc1", make([]byte, visualSampleEntryHeader), ext)
	stsd := mk("stsd", u32(0), u32(1), entry)
	trak := mk("trak", mk("mdia", hdlr, mk("minf", mk("stbl", stsd))), trakExtra)
	data := append(mk("ftyp", []byte("isom"), u32(0)), mk("mdat", make([]byte, 1024))...)
	data = append(data, mk("moov", trak)...)
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, data, 0644); err != nil {
		t.Fatal(err)
	}
	return p
}

func equi(left, right uint32) []byte {
	return mk("sv3d", mk("svhd", u32(0), []byte{0}),
		mk("proj", mk("prhd", u32(0), u32(0), u32(0), u32(0)), mk("equi", u32(0), u32(0), u32(0), u32(left), u32(right))))
}

func TestMetadataV2(t *testing.T) {
	cases := []struct {
		name string
		ext  []byte
		want Format
	}{
		{"vr180", append(mk("st3d", u32(0), []byte{2}), equi(0x40000000, 0x40000000)...), Format{"left", "equirect", 180, "metadata"}},
		{"360tb", append(mk("st3d", u32(0), []byte{1}), equi(0, 0)...), Format{"top", "equirect", 360, "metadata"}},
		{"mono", mk("st3d", u32(0), []byte{0}), Format{"full", "", 0, "metadata"}},
		{"cubemap", mk("sv3d", mk("proj", mk("cbmp", u32(0), u32(0), u32(0)))), Format{}},
	}
	for _, c := range cases {
		got := Detect(writeMP4(t, c.name+".mp4", c.ext, nil))
		if got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
}

func TestMetadataV1(t *testing.T) {
	xml := `<rdf:SphericalVideo><GSpherical:Spherical>true</GSpherical:Spherical>` +
		`<GSpherical:ProjectionType>equirectangular</GSpherical:ProjectionType>` +
		`<GSpherical:StereoMode>top-bottom</GSpherical:StereoMode>` +
		`<GSpherical:CroppedAreaImageWidthPixels>1920</GSpherical:CroppedAreaImageWidthPixels>` +
		`<GSpherical:FullPanoWidthPixels>3840</GSpherical:FullPanoWidthPixels></rdf:SphericalVideo>`
	uuid := mk("uuid", sphericalV1UUID, []byte(xml))
	got := Detect(writeMP4(t, "v1.mp4", nil, uuid))
	want := Format{"top", "equirect", 180, "metadata"}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestMetadataFilledByFileName(t *testing.T) {
	// st3d だけあって投影が無いときは、ファイル名で投影を補う
	got := Detect(writeMP4(t, "clip_360.mp4", mk("st3d", u32(0), []byte{0}), nil))
	want := Format{"full", "equirect", 360, "metadata+filename"}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestFileName(t *testing.T) {
	cases := map[string]Format{
		`C:\v\scene_180_LR.mp4`:  {Start: "left", Projection: "equirect", FOV: 180},
		"trip-360-TB.mkv":        {Start: "top", Projection: "equirect", FOV: 360},
		"walk_MONO_360.webm":     {Start: "full", Projection: "equirect", FOV: 360},
		"cam_FISHEYE190_SBS.mp4": {Start: "left", Projection: "equidistant", FOV: 190},
		"cam_fisheye_ou.mp4":     {Start: "top", Projection: "equidistant", FOV: 180},
		"LRBS_holiday.mp4":       {},
		"episode_1800.mp4":       {},
	}
	for name, want := range cases {
		if got := FromFileName(name); got != want {
			t.Errorf("%s: got %+v, want %+v", name, got, want)
		}
	}
}

func TestDetectMissingFile(t *testing.T) {
	got := Detect(filepath.Join(t.TempDir(), "none_180_LR.mp4"))
	want := Format{"left", "equirect", 180, "filename"}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}
