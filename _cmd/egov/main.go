package main

import (
	"crypto/rand"
	"egov"
	"embed"
	"encoding/hex"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// フロントエンドのビルド結果（Vite の出力）をバイナリへ埋め込む。
// フロントの変更を本番バイナリへ入れるにはビルドし直す。
//
//go:embed all:frontend/dist
var assets embed.FS

//go:embed version
var appVersion string

func main() {
	initialFile := ""
	if len(os.Args) > 1 {
		initialFile = os.Args[1]
	}

	setupLogger()

	// WebView 生成前に環境変数を確定させる必要がある（Linux の WebKitGTK 向け）
	configureWebviewEnv()

	if err := egov.DistributeLocales(); err != nil {
		slog.Warn("locales distribute error", "err", err)
	}

	// LoadSettings はエラー時もデフォルト設定を返すため、そのまま使用できる。
	settings, err := egov.LoadSettings()
	if err != nil {
		slog.Warn("settings load error (using defaults)", "err", err)
	}

	// シングルインスタンスモード: 既存プロセスにファイルを送って終了
	ipcFileCh := make(chan string, 16)
	if settings.App.SingleInstance {
		isServer := tryIPCServer(func(path string) { ipcFileCh <- path })
		if !isServer {
			if initialFile != "" {
				if err := sendIPC(initialFile); err != nil {
					slog.Error("IPC send error", "err", err)
				}
			}
			return
		}
	}

	// 起動時ランダムトークンを生成
	tokenBytes := make([]byte, 16)
	if _, err := rand.Read(tokenBytes); err != nil {
		slog.Error("failed to generate token", "err", err)
		os.Exit(1)
	}
	secret := hex.EncodeToString(tokenBytes)

	// ローカルファイル配信用サーバをランダムポートで起動
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		slog.Error("failed to listen", "err", err)
		os.Exit(1)
	}
	fileServerPort := listener.Addr().(*net.TCPAddr).Port
	// 許可パスのホワイトリストと URL の組み立て（起動引数のファイルは GetInitialFile で登録される）
	files := egov.NewLocalFiles(fileServerPort, secret)
	anims := egov.NewAnimStore()
	// ロケール JSON・許可済みローカルファイル・アニメーション画像のフレームを配信する
	go http.Serve(listener, egov.NewFileHandler(files, anims))

	version := strings.TrimSpace(appVersion)
	if isDev {
		version += "+DEV"
	}

	// 設定はここから先 store を通してだけ読み書きする（API と終了処理で共有するため）
	store := egov.NewSettingsStore(settings)
	api := egov.NewApi(initialFile, files, store, version, anims)

	// Webview のユーザーデータは固定パスに置く。
	// 起動ごとの一時ディレクトリだと %TEMP% に溜まり続け、キャッシュも効かない。
	webviewDir := filepath.Join(os.TempDir(), "egov-webview")
	if dir, err := egov.SettingsDir(); err == nil {
		webviewDir = filepath.Join(dir, "webview")
	}

	app := application.New(application.Options{
		Name:        "egov",
		Description: "Split-screen VR video player",
		Services: []application.Service{
			application.NewService(api),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		Windows: application.WindowsOptions{
			WebviewUserDataPath: webviewDir,
		},
	})

	// ウィンドウオプションを構築
	winOpts := application.WebviewWindowOptions{
		Title: "EgoV",
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(27, 38, 54),
		URL:              "/",
		Frameless:        true,
		MinWidth:         400,
		MinHeight:        300,
		EnableFileDrop:   true,
	}

	// 前回のウィンドウ位置・サイズを復元。
	// app.Run() 前は ScreenNearestDipPoint が使えないため、
	// ここでは安全な上限でクランプし、Run() 後にスクリーン情報で再調整する。
	savedWS := settings.Window
	if savedWS.Width > 0 && savedWS.Height > 0 {
		w, h := savedWS.Width, savedWS.Height
		const fallbackMaxW, fallbackMaxH = 1280, 800
		if w > fallbackMaxW {
			w = fallbackMaxW
		}
		if h > fallbackMaxH {
			h = fallbackMaxH
		}
		winOpts.Width = w
		winOpts.Height = h
		winOpts.X = savedWS.X
		winOpts.Y = savedWS.Y
		winOpts.InitialPosition = application.WindowXY
	}

	win := app.Window.NewWithOptions(winOpts)

	// 最前面表示を復元
	if settings.App.AlwaysOnTop {
		win.SetAlwaysOnTop(true)
	}

	// ドラッグ&ドロップ。
	//
	// Wails はネイティブ側でドロップを横取りし、ドロップ先の要素が
	// data-file-drop-target を持つ場合にこのイベントを発火させる。
	// Linux(WebKitGTK)/macOS では DOM の drop イベント自体が配送されないため、
	// フロントエンドの dataTransfer には依存できない。Windows でも
	// ランタイムがドロップを Go へ転送するので、全プラットフォームで
	// この経路に一本化する。
	win.OnWindowEvent(events.Common.WindowFilesDropped, func(e *application.WindowEvent) {
		for _, path := range e.Context().DroppedFiles() {
			// 動画・画像以外は無視する（従来のフロントエンド側 MIME 判定と同じ扱い）
			if !egov.IsMediaFile(path) {
				continue
			}
			app.Event.Emit("open-file", files.Allow(path))
			// 複数ドロップされても最初の1件だけ開く
			return
		}
	})

	// WindowRuntimeReady でウィンドウ準備完了を待ってから
	// 保存済みの位置・サイズをスクリーンにクランプして適用する。
	if savedWS.Width > 0 && savedWS.Height > 0 {
		win.OnWindowEvent(events.Common.WindowRuntimeReady, func(e *application.WindowEvent) {
			w, h := savedWS.Width, savedWS.Height
			x, y := savedWS.X, savedWS.Y

			cx, cy := x+w/2, y+h/2
			screen := application.ScreenNearestDipPoint(application.Point{X: cx, Y: cy})
			if screen == nil {
				return
			}
			wa := screen.WorkArea

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
			win.SetSize(w, h)
			win.SetPosition(x, y)
		})
	}

	// フロントエンドから API.Quit() 経由で egov.QuitRequested に通知される。
	// ウィンドウ破棄前に Position()/Size() を取得して保存する。
	// 最大化・フルスクリーン・最小化中はその座標を保存すると復元時に
	// 異常なサイズになるため、前回保存済みの通常時の値を維持する。
	// それ以外の設定は変更のたびに API が保存済みなので、ここでは書かない。
	go func() {
		<-egov.QuitRequested
		if !win.IsMaximised() && !win.IsFullscreen() && !win.IsMinimised() {
			x, y := win.Position()
			w, h := win.Size()
			if err := store.SetWindow(egov.WindowSettings{X: x, Y: y, Width: w, Height: h}); err != nil {
				slog.Error("settings save error", "err", err)
			}
		}
		app.Quit()
	}()

	// IPC経由で受信したファイルパスをホワイトリストに追加してフロントエンドへ転送
	go func() {
		for path := range ipcFileCh {
			fileUrl := files.Allow(path)
			win.Show()
			win.Focus()
			app.Event.Emit("open-file", fileUrl)
		}
	}()

	if err = app.Run(); err != nil {
		slog.Error("application error", "err", err)
		os.Exit(1)
	}
}

func setupLogger() {
	level := slog.LevelInfo
	if isDev {
		level = slog.LevelDebug
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: level,
	})))
}
