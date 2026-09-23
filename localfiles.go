package egov

import (
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// LocalFiles はローカルファイル配信サーバの許可リストと URL を管理する。
// フロントエンドが読めるのは、ユーザーが明示的に開いたファイル
// （起動引数・二重起動の転送・ドロップ・ファイル選択ダイアログ）だけに限る。
type LocalFiles struct {
	port    int
	secret  string
	mu      sync.RWMutex
	allowed map[string]struct{}
}

func NewLocalFiles(port int, secret string) *LocalFiles {
	return &LocalFiles{port: port, secret: secret, allowed: map[string]struct{}{}}
}

// Allow は path を許可リストへ登録し、再生用の URL を返す。
func (l *LocalFiles) Allow(path string) string {
	l.mu.Lock()
	l.allowed[path] = struct{}{}
	l.mu.Unlock()
	return l.URL(path)
}

// IsAllowed は path が許可リストにあるかを返す。
func (l *LocalFiles) IsAllowed(path string) bool {
	l.mu.RLock()
	defer l.mu.RUnlock()
	_, ok := l.allowed[path]
	return ok
}

// Authorized はリクエストが起動時のトークンを持っているかを返す。
func (l *LocalFiles) Authorized(r *http.Request) bool {
	return subtle.ConstantTimeCompare([]byte(r.URL.Query().Get("token")), []byte(l.secret)) == 1
}

// URL は path を配信する URL を返す（許可リストへの登録はしない）。
func (l *LocalFiles) URL(path string) string {
	return fmt.Sprintf("http://127.0.0.1:%d/localfile?token=%s&path=%s",
		l.port, l.secret, url.QueryEscape(path))
}

// BaseURL はローカルファイル配信サーバの URL（ロケール JSON などの取得元）。
func (l *LocalFiles) BaseURL() string {
	return fmt.Sprintf("http://127.0.0.1:%d", l.port)
}

// OpenLocalFile はファイル選択ダイアログで選ばれた path を許可リストへ登録し、
// 再生用の URL を返す。<input type="file"> はブラウザの制約でパスが取れず、
// Go 側での処理（アニメーション画像の展開・無劣化切り出し・VR形式の推定）が
// できないため、ダイアログは Wails の Dialogs.OpenFile で出してパスを受け取る。
func (a *API) OpenLocalFile(path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", errors.New("not an absolute path")
	}
	st, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if !st.Mode().IsRegular() {
		return "", errors.New("not a regular file")
	}
	if !IsMediaFile(path) {
		return "", fmt.Errorf("unsupported file type: %s", filepath.Ext(path))
	}
	return a.files.Allow(path), nil
}

// MediaFilePattern はファイル選択ダイアログのフィルタ（"*.mp4;*.png;..."）を返す。
// 開ける拡張子は Go 側（videoExts / imageExts）が正本なので、ここから組み立てる。
func (a *API) MediaFilePattern() string {
	exts := make([]string, 0, len(videoExts)+len(imageExts))
	for e := range videoExts {
		exts = append(exts, "*"+e)
	}
	for e := range imageExts {
		exts = append(exts, "*"+e)
	}
	sort.Strings(exts)
	return strings.Join(exts, ";")
}
