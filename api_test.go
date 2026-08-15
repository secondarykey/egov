package egov

import (
	"os"
	"path/filepath"
	"runtime"
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

	otherDir := t.TempDir()

	tests := []struct {
		name    string
		input   string
		want    string // 空なら期待はエラー
		wantErr bool
	}{
		{"フルパス指定", filepath.Join(dir, "cut.mp4"), filepath.Join(dir, "cut.mp4"), false},
		{"別フォルダも可", filepath.Join(otherDir, "cut.mp4"), filepath.Join(otherDir, "cut.mp4"), false},
		{"拡張子省略時は元と同じものを補う", filepath.Join(dir, "cut"), filepath.Join(dir, "cut.mp4"), false},
		{"前後の空白は落とす", "  " + filepath.Join(dir, "cut.mp4") + "  ", filepath.Join(dir, "cut.mp4"), false},
		{"空なら自動命名", "", filepath.Join(dir, "movie_00m02s-00m07s.mp4"), false},
		// 既存ファイルの上書き確認はネイティブダイアログ側の責務
		{"既存ファイルは通す", filepath.Join(dir, "taken.mp4"), filepath.Join(dir, "taken.mp4"), false},
		{"元ファイルへの上書きは拒否", src, "", true},
		{"相対パスは拒否", "cut.mp4", "", true},
		{"存在しないフォルダは拒否", filepath.Join(dir, "nope", "cut.mp4"), "", true},
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
			if got != tt.want {
				t.Errorf("= %q, want %q", got, tt.want)
			}
		})
	}
}

// Windows/macOS では大文字小文字が違うだけの指定も元ファイルを指す。
func TestResolveExtractPathRejectsCaseVariantOfSource(t *testing.T) {
	if runtime.GOOS != "windows" && runtime.GOOS != "darwin" {
		t.Skip("大文字小文字を区別しないファイルシステム向けの確認")
	}
	dir := t.TempDir()
	src := filepath.Join(dir, "movie.mp4")
	if err := os.WriteFile(src, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveExtractPath(src, filepath.Join(dir, "MOVIE.MP4"), 2, 7); err == nil {
		t.Error("大文字小文字違いでも元ファイルへの上書きは拒否されるべき")
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
		// シークバーのマーカー表示に合わせて切り捨てる（四捨五入すると食い違う）
		{2.6, "00m02s"},
		{54.6, "00m54s"},
		{59.9, "00m59s"},
		{125, "02m05s"},
		{3725, "1h02m05s"},
		{-1, "00m00s"},
	}
	for _, tt := range tests {
		if got := timeTag(tt.sec); got != tt.want {
			t.Errorf("timeTag(%v) = %q, want %q", tt.sec, got, tt.want)
		}
	}
}
