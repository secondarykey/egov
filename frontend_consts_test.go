package egov

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"testing"
)

// Go とフロントエンドで同じ値を別々に持っている定数を突き合わせる。
// どちらかだけ変えたときにここで落ちる。

const frontendSrc = "_cmd/egov/frontend/src"

func readFrontend(t *testing.T, rel string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(frontendSrc, rel))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// jsNumber は `export const NAME = 1.5` の値を返す。
func jsNumber(t *testing.T, src, name string) float64 {
	t.Helper()
	m := regexp.MustCompile(`(?m)^export const ` + name + `\s*=\s*([0-9.]+)\s*$`).FindStringSubmatch(src)
	if m == nil {
		t.Fatalf("%s が見つからない", name)
	}
	v, err := strconv.ParseFloat(m[1], 64)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

// jsStrings は `export const NAME = ['a', 'b']` の要素を返す。
func jsStrings(t *testing.T, src, name string) []string {
	t.Helper()
	m := regexp.MustCompile(`(?m)^export const ` + name + `\s*=\s*\[([^\]]*)\]`).FindStringSubmatch(src)
	if m == nil {
		t.Fatalf("%s が見つからない", name)
	}
	var out []string
	for _, q := range regexp.MustCompile(`'([^']*)'`).FindAllStringSubmatch(m[1], -1) {
		out = append(out, q[1])
	}
	return out
}

func TestFrontendConstsMatch(t *testing.T) {
	utils := readFrontend(t, "player/utils.js")
	shader := readFrontend(t, "player/vrShader.js")

	numbers := []struct {
		name string
		js   string
		goV  float64
	}{
		{"VR_SHIFT_LIMIT", utils, vrShiftLimit},
		{"VR_FOV_MIN", utils, vrFovMin},
		{"VR_FOV_MAX", utils, vrFovMax},
		{"ZOOM_FEATHER_MAX", utils, zoomFeatherMax},
	}
	for _, n := range numbers {
		if got := jsNumber(t, n.js, n.name); got != n.goV {
			t.Errorf("%s: フロント %v, Go %v", n.name, got, n.goV)
		}
	}

	// 画像の拡張子（utils.IMAGE_EXTS と imageExts）
	exts := jsStrings(t, utils, "IMAGE_EXTS")
	for _, e := range exts {
		if _, ok := imageExts[e]; !ok {
			t.Errorf("IMAGE_EXTS の %s が Go の imageExts に無い", e)
		}
	}
	for e := range imageExts {
		if !slices.Contains(exts, e) {
			t.Errorf("Go の imageExts の %s が IMAGE_EXTS に無い", e)
		}
	}

	// 素材の画角の範囲（SRC_FOV_RANGE と sourceFovRange）
	rangeRe := regexp.MustCompile(`(?m)^\s*(\w+):\s*\{\s*min:\s*([0-9.]+),\s*max:\s*([0-9.]+),\s*def:\s*([0-9.]+)\s*\}`)
	rows := rangeRe.FindAllStringSubmatch(shader, -1)
	srcProjs := jsStrings(t, shader, "SOURCE_PROJECTIONS")
	if len(rows) != len(srcProjs) {
		t.Errorf("SRC_FOV_RANGE は %d 件、SOURCE_PROJECTIONS は %d 件", len(rows), len(srcProjs))
	}
	for _, r := range rows {
		lo, hi, def := sourceFovRange(r[1])
		want := []float64{lo, hi, def}
		for i, s := range r[2:] {
			v, _ := strconv.ParseFloat(s, 64)
			if v != want[i] {
				t.Errorf("SRC_FOV_RANGE.%s: フロント %v, Go %v", r[1], r[2:], want)
				break
			}
		}
	}

	// フロントが選ばせる投影方式は、Go の normalize() が既定値へ戻さないこと
	for _, p := range srcProjs {
		s := defaultSettings()
		s.VR.SourceProjection = p
		s.normalize()
		if s.VR.SourceProjection != p {
			t.Errorf("SOURCE_PROJECTIONS の %s を Go が受け付けない", p)
		}
	}
	for _, p := range jsStrings(t, shader, "DISPLAY_PROJECTIONS") {
		s := defaultSettings()
		s.VR.DisplayProjection = p
		s.normalize()
		if s.VR.DisplayProjection != p {
			t.Errorf("DISPLAY_PROJECTIONS の %s を Go が受け付けない", p)
		}
	}
}
