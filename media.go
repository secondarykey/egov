package egov

import (
	"log/slog"
	"net/http"
	"path/filepath"

	"egov/internal/animimage"
)

// ServeLocalFile はローカルファイルをフロントエンドへ配信する（Range 対応）。
// アニメーション AVIF だけは video 要素で再生できる形に読み替えて渡す
// （animimage.AVIFVideo 参照）。認証とホワイトリストの確認は呼び出し側で済ませること。
func ServeLocalFile(w http.ResponseWriter, r *http.Request, path string) {
	if !animimage.IsAVIFSequence(path) {
		http.ServeFile(w, r, path)
		return
	}
	a, err := animimage.OpenAVIFForVideo(path)
	if err != nil {
		slog.Warn("avif: fallback to raw file", "path", path, "err", err)
		http.ServeFile(w, r, path)
		return
	}
	defer a.Close()
	st, err := a.Stat()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	http.ServeContent(w, r, filepath.Base(path), st.ModTime(), a)
}
