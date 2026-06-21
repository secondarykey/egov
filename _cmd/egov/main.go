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
		MinWidth:               400,
		MinHeight:              300,
		OpenInspectorOnStartup: debug,
		EnableFileDrop:         true,
	}

	// 前回のウィンドウ位置・サイズを復元。
	// app.Run() 前は ScreenNearestDipPoint が使えないため、
	// ここでは安全な上限でクランプし、Run() 後にスクリーン情報で再調整する。
	savedWS := settings.Window
	if savedWS.Width > 0 && savedWS.Height > 0 {
		w, h := savedWS.Width, savedWS.Height
		// Run()前のフォールバック上限（FHD相当）
		const fallbackMaxW, fallbackMaxH = 1280, 800
		if w > fallbackMaxW {
			w = fallbackMaxW
		}
		if h > fallbackMaxH {
			h = fallbackMaxH
		}
		winOpts.Width = w
		winOpts.Height = h
	}

	win := app.Window.NewWithOptions(winOpts)

	// 最前面表示を復元
	if settings.App.AlwaysOnTop {
		win.SetAlwaysOnTop(true)
	}

	// app.Run() 後にスクリーン情報が利用可能になったら、
	// 保存済みの位置・サイズを正しいスクリーンにクランプして適用する。
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(e *application.ApplicationEvent) {
		if savedWS.Width <= 0 || savedWS.Height <= 0 {
			return
		}
		w, h := savedWS.Width, savedWS.Height
		x, y := savedWS.X, savedWS.Y

		cx, cy := x+w/2, y+h/2
		screen := application.ScreenNearestDipPoint(application.Point{X: cx, Y: cy})
		if screen == nil {
			log.Printf("[window-restore] no screen found for center (%d,%d)", cx, cy)
			return
		}
		wa := screen.WorkArea
		log.Printf("[window-restore] saved: x=%d y=%d w=%d h=%d", savedWS.X, savedWS.Y, savedWS.Width, savedWS.Height)
		log.Printf("[window-restore] workArea: x=%d y=%d w=%d h=%d", wa.X, wa.Y, wa.Width, wa.Height)

		const margin = 10
		maxW := wa.Width - margin*2
		maxH := wa.Height - margin*2
		if maxW < 400 {
			maxW = 400
		}
		if maxH < 300 {
			maxH = 300
		}
		if w > maxW {
			w = maxW
		}
		if h > maxH {
			h = maxH
		}
		if x < wa.X+margin {
			x = wa.X + margin
		}
		if y < wa.Y+margin {
			y = wa.Y + margin
		}
		if x+w > wa.X+wa.Width-margin {
			x = wa.X + wa.Width - margin - w
		}
		if y+h > wa.Y+wa.Height-margin {
			y = wa.Y + wa.Height - margin - h
		}
		log.Printf("[window-restore] clamped: x=%d y=%d w=%d h=%d", x, y, w, h)
		win.SetSize(w, h)
		win.SetPosition(x, y)
	})

	// WindowClosing 時の Position() が (0,0) を返すことがある（frameless + 左端スナップ等）。
	// 移動・リサイズイベントで最後の正しい座標を追跡し、保存時に使う。
	var lastX, lastY, lastW, lastH int
	trackWindowState := func() {
		x, y := win.Position()
		w, h := win.Size()
		if x != 0 || y != 0 || w != lastW || h != lastH {
			lastX, lastY, lastW, lastH = x, y, w, h
		}
	}
	win.OnWindowEvent(events.Common.WindowDidMove, func(e *application.WindowEvent) {
		trackWindowState()
	})
	win.OnWindowEvent(events.Common.WindowDidResize, func(e *application.WindowEvent) {
		trackWindowState()
	})

	win.OnWindowEvent(events.Common.WindowClosing, func(e *application.WindowEvent) {
		posX, posY := win.Position()
		sizeW, sizeH := win.Size()
		x, y := posX, posY
		w, h := sizeW, sizeH
		if x == 0 && y == 0 && (lastX != 0 || lastY != 0) {
			x, y = lastX, lastY
		}
		if w == 0 && h == 0 && (lastW != 0 || lastH != 0) {
			w, h = lastW, lastH
		}
		log.Printf("[window-save] Position()=%d,%d Size()=%d,%d tracked=%d,%d,%d,%d final=%d,%d,%d,%d",
			posX, posY, sizeW, sizeH, lastX, lastY, lastW, lastH, x, y, w, h)
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
