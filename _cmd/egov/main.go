package main

import (
	"crypto/rand"
	"egov"
	"embed"
	_ "embed"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Wails uses Go's `embed` package to embed the frontend files into the binary.
// Any files in the frontend/dist folder will be embedded into the binary and
// made available to the frontend.
// See https://pkg.go.dev/embed for more information.

//go:embed all:frontend/dist
var assets embed.FS

//go:embed version
var appVersion string

// main function serves as the application's entry point. It initializes the
// application, creates a window, and runs the application, logging any error
// that might occur.
func main() {

	// Create a new Wails application by providing the necessary options.
	// Variables 'Name' and 'Description' are for application metadata.
	// 'Assets' configures the asset server with the 'FS' variable pointing to the frontend files.
	// 'Bind' is a list of Go struct instances. The frontend has access to the methods of these instances.
	// 'Mac' options tailor the application when running an macOS.
	initialFile := ""
	if len(os.Args) > 1 {
		initialFile = os.Args[1]
	}

	if err := egov.DistributeLocales(); err != nil {
		log.Printf("locales distribute error: %v", err)
	}

	settings, err := egov.LoadSettings()
	if err != nil {
		log.Printf("settings load error: %v", err)
		settings = &egov.Settings{}
	}

	// シングルインスタンスモード: 既存プロセスにファイルを送って終了
	ipcFileCh := make(chan string, 16)
	if settings.App.SingleInstance {
		isServer := tryIPCServer(func(path string) { ipcFileCh <- path })
		if !isServer {
			if initialFile != "" {
				if err := sendIPC(initialFile); err != nil {
					log.Printf("IPC send error: %v", err)
				}
			}
			return
		}
	}

	// 起動時ランダムトークンを生成
	tokenBytes := make([]byte, 16)
	if _, err := rand.Read(tokenBytes); err != nil {
		log.Fatal(err)
	}
	secret := hex.EncodeToString(tokenBytes)

	// 許可パスのホワイトリスト
	var mu sync.RWMutex
	allowed := map[string]struct{}{}
	if initialFile != "" {
		allowed[initialFile] = struct{}{}
	}

	// ローカルファイル配信用サーバをランダムポートで起動
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	fileServerPort := listener.Addr().(*net.TCPAddr).Port
	go http.Serve(listener, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// CORS: webview（wails オリジン）とローカル開発サーバのみ許可。
		// 任意オリジンに開かないことで、外部サイトからの読み出しを防ぐ。
		if origin := r.Header.Get("Origin"); isAllowedOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		urlPath := r.URL.Path

		// ロケール: /languages.json
		if urlPath == "/languages.json" {
			data, err := egov.ReadLanguagesJSON()
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
			if !egov.IsValidLocaleCode(code) {
				http.Error(w, "Not Found", http.StatusNotFound)
				return
			}
			data, err := egov.ReadLocaleFile(code)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write(data)
			return
		}

		// ローカルファイル: トークン認証 + ホワイトリスト
		if r.URL.Query().Get("token") != secret {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		path := r.URL.Query().Get("path")
		mu.RLock()
		_, ok := allowed[path]
		mu.RUnlock()
		if !ok {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		http.ServeFile(w, r, path)
	}))

	version := strings.TrimSpace(appVersion)
	if isDev {
		version += "+DEV"
	}

	app := application.New(application.Options{
		Name:        "egov",
		Description: "A demo of using raw HTML & CSS",
		Services: []application.Service{
			application.NewService(egov.NewApi(initialFile, fileServerPort, secret, settings, version)),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		Windows: application.WindowsOptions{
			WebviewUserDataPath: filepath.Join(os.TempDir(), "egov-"+secret),
		},
	})

	debug := false

	// ウィンドウオプションを構築
	winOpts := application.WebviewWindowOptions{
		Title: "EgoV",
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour:       application.NewRGB(27, 38, 54),
		URL:                    "/",
		Frameless:              true,
		OpenInspectorOnStartup: debug,
		EnableFileDrop:         true,
	}

	// 前回のウィンドウ位置・サイズを復元（スクリーンに収まるよう調整）
	// NewWithOptions に直接渡すことで位置とサイズをアトミックに適用し、
	// DPI 変換が正しいスクリーンで行われるようにする。
	// SetPosition は app.Run() 前は impl==nil のため無視されるため、この方法が必要。
	if ws := settings.Window; ws.Width > 0 && ws.Height > 0 {
		w, h := ws.Width, ws.Height
		x, y := ws.X, ws.Y
		// ウィンドウ中心に最も近いスクリーンを取得してサイズと位置を制限
		cx, cy := x+w/2, y+h/2
		if screen := application.ScreenNearestDipPoint(application.Point{X: cx, Y: cy}); screen != nil {
			wa := screen.WorkArea
			if w > wa.Width {
				w = wa.Width
			}
			if h > wa.Height {
				h = wa.Height
			}
			if x < wa.X {
				x = wa.X
			}
			if y < wa.Y {
				y = wa.Y
			}
			if x+w > wa.X+wa.Width {
				x = wa.X + wa.Width - w
			}
			if y+h > wa.Y+wa.Height {
				y = wa.Y + wa.Height - h
			}
		}
		winOpts.Width = w
		winOpts.Height = h
		winOpts.X = x
		winOpts.Y = y
		winOpts.InitialPosition = application.WindowXY
	}

	win := app.Window.NewWithOptions(winOpts)

	// 最前面表示を復元
	if settings.App.AlwaysOnTop {
		win.SetAlwaysOnTop(true)
	}

	// 閉じる時にウィンドウ位置・サイズを保存
	win.OnWindowEvent(events.Common.WindowClosing, func(e *application.WindowEvent) {
		w, h := win.Size()
		x, y := win.Position()
		settings.Window = egov.WindowSettings{X: x, Y: y, Width: w, Height: h}
		if err := egov.SaveSettings(settings); err != nil {
			log.Printf("settings save error: %v", err)
		}
	})

	// IPC経由で受信したファイルパスをホワイトリストに追加してフロントエンドへ転送
	go func() {
		for path := range ipcFileCh {
			mu.Lock()
			allowed[path] = struct{}{}
			mu.Unlock()
			fileUrl := fmt.Sprintf("http://127.0.0.1:%d/localfile?token=%s&path=%s",
				fileServerPort, secret, url.QueryEscape(path))
			win.Show()
			win.Focus()
			app.Event.Emit("open-file", fileUrl)
		}
	}()

	// Run the application. This blocks until the application has been exited.
	err = app.Run()
	// If an error occurred while running the application, log it and exit.
	if err != nil {
		log.Fatal(err)
	}
}

// isAllowedOrigin reports whether a CORS Origin header should be reflected.
// 本番では webview の wails オリジン、開発時はループバックの dev サーバを許可する。
// 外部サイトのオリジン（例: https://evil.com）はブラウザが詐称できないため拒否される。
func isAllowedOrigin(origin string) bool {
	switch origin {
	case "http://wails.localhost", "wails://localhost":
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	switch u.Hostname() {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	return false
}
