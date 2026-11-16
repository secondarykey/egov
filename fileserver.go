package egov

import (
	"net/http"
	"net/url"
	"strings"
)

// NewFileHandler は WebView 向けのローカル HTTP サーバ（127.0.0.1 のランダムポート）の
// ハンドラを返す。配信するのは次の3つ。
//
//   - /languages.json, /languages/{code}.json … ロケール（認証なし）
//   - /animframe?id=&i= … アニメーション画像の合成済みフレーム（API.OpenAnimation で展開したもの）
//   - /localfile?path= … ユーザーが明示的に開いたファイル（LocalFiles の許可リスト）
//
// ロケール以外は起動時のトークンが必要。
func NewFileHandler(files *LocalFiles, anims *AnimStore) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// CORS: webview（wails オリジン）とローカル開発サーバのみ許可。
		// 任意オリジンに開かないことで、外部サイトからの読み出しを防ぐ。
		if origin := r.Header.Get("Origin"); isAllowedOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		urlPath := r.URL.Path

		// ロケール: /languages.json
		if urlPath == "/languages.json" {
			data, err := ReadLanguagesJSON()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write(data)
			return
		}

		// ロケール: /languages/{code}.json
		if strings.HasPrefix(urlPath, "/languages/") && strings.HasSuffix(urlPath, ".json") {
			code := strings.TrimSuffix(strings.TrimPrefix(urlPath, "/languages/"), ".json")
			// パストラバーサル対策: ロケールコードは英数字とハイフン・アンダースコアのみ許可。
			if !IsValidLocaleCode(code) {
				http.Error(w, "Not Found", http.StatusNotFound)
				return
			}
			data, err := ReadLocaleFile(code)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write(data)
			return
		}

		// ローカルファイル: トークン認証 + ホワイトリスト
		if !files.Authorized(r) {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

		if urlPath == "/animframe" {
			anims.ServeFrame(w, r)
			return
		}

		path := r.URL.Query().Get("path")
		if !files.IsAllowed(path) {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		ServeLocalFile(w, r, path)
	})
}

// isAllowedOrigin reports whether a CORS Origin header should be reflected.
// 本番では webview の wails オリジン（wails.localhost）、開発時はループバックの
// dev サーバを許可する。dev では wails がオリジンにポートを付与する
// （例: http://wails.localhost:9245）ため、完全一致ではなくホスト名で判定する。
// 外部サイトのオリジン（例: https://evil.com）はブラウザが詐称できないため拒否される。
func isAllowedOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	switch u.Hostname() {
	case "wails.localhost", "localhost", "127.0.0.1", "::1":
		return true
	}
	return false
}
