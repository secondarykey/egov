package egov

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveExtractPath(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "movie.mp4")
	if err := os.WriteFile(src, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "taken.mp4"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name    string
		input   string
		want    string // 空なら期待はエラー
		wantErr bool
	}{
		{"名前指定", "cut.mp4", "cut.mp4", false},
		{"拡張子省略時は元と同じものを補う", "cut", "cut.mp4", false},
		{"前後の空白は落とす", "  cut.mp4  ", "cut.mp4", false},
		{"空なら自動命名", "", "movie_00m02s-00m07s.mp4", false},
		{"既存ファイルは拒否", "taken.mp4", "", true},
		{"元ファイルと同名は拒否", "movie.mp4", "", true},
		{"パス区切りは拒否", "sub/cut.mp4", "", true},
		{"親ディレクトリ指定は拒否", "../cut.mp4", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := resolveExtractPath(src, tt.input, 2, 7)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("エラーを期待したが %q が返った", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("resolveExtractPath: %v", err)
			}
			if filepath.Base(got) != tt.want {
				t.Errorf("= %q, want %q", filepath.Base(got), tt.want)
			}
			if d := filepath.Dir(got); d != dir {
				t.Errorf("保存先ディレクトリ = %q, want %q", d, dir)
			}
		})
	}
}

func TestUniqueExtractPathAvoidsCollision(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "movie.mp4")

	first, err := uniqueExtractPath(src, 2, 7)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(first, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	second, err := uniqueExtractPath(src, 2, 7)
	if err != nil {
		t.Fatal(err)
	}
	if second == first {
		t.Fatalf("既存名 %q と同じ名前が返った", first)
	}
	if got, want := filepath.Base(second), "movie_00m02s-00m07s_2.mp4"; got != want {
		t.Errorf("= %q, want %q", got, want)
	}
}

func TestTimeTag(t *testing.T) {
	tests := []struct {
		sec  float64
		want string
	}{
		{0, "00m00s"},
		{2.4, "00m02s"},
		{2.6, "00m03s"}, // 四捨五入
		{125, "02m05s"},
		{3725, "1h02m05s"},
	}
	for _, tt := range tests {
		if got := timeTag(tt.sec); got != tt.want {
			t.Errorf("timeTag(%v) = %q, want %q", tt.sec, got, tt.want)
		}
	}
}
