package egov

import (
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"egov/internal/mp4cut"
)

// LocalFileURL builds a playable URL for path on the local file server.
func LocalFileURL(port int, secret, path string) string {
	return fmt.Sprintf("http://127.0.0.1:%d/localfile?token=%s&path=%s",
		port, secret, url.QueryEscape(path))
}

// videoExts はドロップを受け付ける拡張子。
// ドラッグ&ドロップは Go 側でパスとして受け取るため、
// ブラウザの MIME 判定（file.type）が使えず拡張子で判断する。
var videoExts = map[string]struct{}{
	".mp4": {}, ".m4v": {}, ".mov": {}, ".mkv": {}, ".webm": {},
	".avi": {}, ".wmv": {}, ".flv": {}, ".mpg": {}, ".mpeg": {},
	".m2ts": {}, ".mts": {}, ".ts": {}, ".ogv": {}, ".3gp": {},
}

// IsVideoFile reports whether path looks like a playable video file.
func IsVideoFile(path string) bool {
	_, ok := videoExts[strings.ToLower(filepath.Ext(path))]
	return ok
}

type API struct {
	// mu guards settings/initialFile. バインディング呼び出しは並行に実行されうる。
	mu             sync.Mutex
	initialFile    string
	fileServerPort int
	secret         string
	settings       *Settings
	version        string
}

// QuitRequested is signaled each time the frontend calls API.Quit(). main
// listens on this channel to save window state and exit. A channel (rather
// than a stored func) is used because the wails3 bindings generator warns
// about any func-typed declaration in this package.
var QuitRequested = make(chan struct{}, 1)

func NewApi(initialFile string, fileServerPort int, secret string, settings *Settings, version string) *API {
	return &API{initialFile: initialFile, fileServerPort: fileServerPort, secret: secret, settings: settings, version: version}
}

// GetVersion returns the application version.
func (a *API) GetVersion() string {
	return a.version
}

// GetServerURL returns the base URL of the local file server.
func (a *API) GetServerURL() string {
	return fmt.Sprintf("http://127.0.0.1:%d", a.fileServerPort)
}

// GetSettings returns the current settings.
func (a *API) GetSettings() Settings {
	a.mu.Lock()
	defer a.mu.Unlock()
	return *a.settings
}

// GetDefaultSettings returns the built-in default settings.
// フロントエンドの「デフォルトに戻す」用。既定値の定義は defaultSettings() に一元化する。
func (a *API) GetDefaultSettings() Settings {
	return *defaultSettings()
}

// save persists settings to disk. 保存失敗は致命的ではない
// （次回起動時にデフォルト値になるだけ）ため、警告ログのみ残して続行する。
// 呼び出し側で a.mu を保持していること。
func (a *API) save() {
	if err := SaveSettings(a.settings); err != nil {
		slog.Warn("settings save error", "err", err)
	}
}

// UpdatePlaybackSettings saves volume, mute, thumbnail state and language to disk.
func (a *API) UpdatePlaybackSettings(volume float64, muted bool, thumbnailEnabled bool, language string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.settings.Playback.Volume = volume
	a.settings.Playback.Muted = muted
	a.settings.Playback.ThumbnailEnabled = thumbnailEnabled
	a.settings.Playback.Language = language
	a.save()
}

// UpdateVRSettings replaces the VR configuration and saves to disk.
func (a *API) UpdateVRSettings(vr VRSettings) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.settings.VR = vr
	a.save()
}

// UpdateControlSettings replaces the control configuration and saves to disk.
func (a *API) UpdateControlSettings(controls ControlSettings) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.settings.Controls = controls
	a.save()
}

// UpdateDefaultMode saves the default playback mode to disk.
func (a *API) UpdateDefaultMode(mode string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.settings.Playback.DefaultMode = mode
	a.save()
}

// UpdateAlwaysOnTop saves the always-on-top state to disk.
func (a *API) UpdateAlwaysOnTop(enabled bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.settings.App.AlwaysOnTop = enabled
	a.save()
}

// UpdateAppSettings replaces the application configuration and saves to disk.
func (a *API) UpdateAppSettings(app AppSettings) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.settings.App = app
	a.save()
}

// UpdateActiveColor saves the UI active color to disk.
func (a *API) UpdateActiveColor(color string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.settings.Playback.ActiveColor = color
	a.save()
}

// Quit signals QuitRequested so main can save the window state and exit.
func (a *API) Quit() {
	select {
	case QuitRequested <- struct{}{}:
	default:
	}
}

// extractableExts は無劣化切り出し（ExtractRange）に対応する拡張子。
// いずれも ISOBMFF なのでサンプルのバイトコピーだけで切り出せる。
// mkv/webm/ts などはコンテナ構造が異なるため対象外。
var extractableExts = map[string]struct{}{
	".mp4": {}, ".m4v": {}, ".mov": {},
}

// CanExtract reports whether path can be range-extracted without re-encoding.
func (a *API) CanExtract(path string) bool {
	_, ok := extractableExts[strings.ToLower(filepath.Ext(path))]
	return ok
}

// ExtractResult describes the file written by ExtractRange.
// StartSec/EndSec は要求値ではなく、キーフレームにスナップされた実際の範囲。
type ExtractResult struct {
	Path     string  `json:"path"`
	FileName string  `json:"fileName"`
	StartSec float64 `json:"startSec"`
	EndSec   float64 `json:"endSec"`
	Size     int64   `json:"size"`
}

// SuggestExtractTarget returns a not-yet-used directory/file name pair for the
// range, used to pre-fill the native save dialog.
func (a *API) SuggestExtractTarget(path string, startSec, endSec float64) (ExtractTarget, error) {
	if path == "" {
		return ExtractTarget{}, fmt.Errorf("切り出し元のファイルが不明です")
	}
	dst, err := uniqueExtractPath(path, startSec, endSec)
	if err != nil {
		return ExtractTarget{}, err
	}
	return ExtractTarget{Dir: filepath.Dir(dst), FileName: filepath.Base(dst)}, nil
}

// ExtractTarget is the default location offered in the save dialog.
type ExtractTarget struct {
	Dir      string `json:"dir"`
	FileName string `json:"fileName"`
}

// ExtractRange writes [startSec, endSec) of path to dstPath without
// re-encoding. 開始点は直前のキーフレームまで戻る。
// dstPath はネイティブの保存ダイアログで選ばれたフルパス。空なら自動命名する。
func (a *API) ExtractRange(path string, startSec, endSec float64, dstPath string) (ExtractResult, error) {
	if path == "" {
		return ExtractResult{}, fmt.Errorf("切り出し元のファイルが不明です")
	}
	if !a.CanExtract(path) {
		return ExtractResult{}, fmt.Errorf("%s は無劣化切り出しに対応していません", filepath.Ext(path))
	}
	dst, err := resolveExtractPath(path, dstPath, startSec, endSec)
	if err != nil {
		return ExtractResult{}, err
	}
	res, err := mp4cut.Cut(path, dst, startSec, endSec)
	if err != nil {
		slog.Error("extract range failed", "src", path, "start", startSec, "end", endSec, "err", err)
		return ExtractResult{}, err
	}
	slog.Info("extracted range", "dst", res.OutputPath, "start", res.StartSec, "end", res.EndSec, "size", res.Size)
	return ExtractResult{
		Path:     res.OutputPath,
		FileName: filepath.Base(res.OutputPath),
		StartSec: res.StartSec,
		EndSec:   res.EndSec,
		Size:     res.Size,
	}, nil
}

// resolveExtractPath validates the destination chosen in the save dialog.
// 既存ファイルの上書き確認はネイティブダイアログ側が済ませているためここでは通すが、
// 読み込み中の元ファイルを潰すのは復旧不能なので必ず弾く。
func resolveExtractPath(src, dstPath string, startSec, endSec float64) (string, error) {
	dstPath = strings.TrimSpace(dstPath)
	if dstPath == "" {
		return uniqueExtractPath(src, startSec, endSec)
	}
	dst := filepath.Clean(dstPath)
	if !filepath.IsAbs(dst) {
		return "", fmt.Errorf("保存先はフルパスで指定してください: %s", dstPath)
	}
	// ダイアログのフィルタで拡張子が省かれることがあるため補う
	if filepath.Ext(dst) == "" {
		dst += filepath.Ext(src)
	}
	if sameFile(dst, src) {
		return "", fmt.Errorf("元のファイルには上書きできません")
	}
	dir := filepath.Dir(dst)
	if fi, err := os.Stat(dir); err != nil || !fi.IsDir() {
		return "", fmt.Errorf("保存先のフォルダがありません: %s", dir)
	}
	return dst, nil
}

// sameFile reports whether two paths point at the same file. Windows/macOS の
// 既定のファイルシステムは大文字小文字を区別しないため、まず os.SameFile で
// 実体を比較し、宛先がまだ存在しない場合のみ文字列比較にフォールバックする。
func sameFile(a, b string) bool {
	fa, errA := os.Stat(a)
	fb, errB := os.Stat(b)
	if errA == nil && errB == nil {
		return os.SameFile(fa, fb)
	}
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
	}
	return filepath.Clean(a) == filepath.Clean(b)
}

// uniqueExtractPath builds "<name>_<start>-<end><ext>" next to src, adding a
// numeric suffix until the name is free.
func uniqueExtractPath(src string, startSec, endSec float64) (string, error) {
	ext := filepath.Ext(src)
	base := strings.TrimSuffix(src, ext)
	stem := fmt.Sprintf("%s_%s-%s", base, timeTag(startSec), timeTag(endSec))
	for i := 0; i < 1000; i++ {
		candidate := stem + ext
		if i > 0 {
			candidate = fmt.Sprintf("%s_%d%s", stem, i+1, ext)
		}
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("出力ファイル名を決められませんでした: %s", stem+ext)
}

// timeTag formats seconds as a filename-safe tag (e.g. 1h02m03s / 02m03s).
func timeTag(sec float64) string {
	total := int(sec + 0.5)
	h, m, s := total/3600, (total/60)%60, total%60
	if h > 0 {
		return fmt.Sprintf("%dh%02dm%02ds", h, m, s)
	}
	return fmt.Sprintf("%02dm%02ds", m, s)
}

// GetInitialFile returns a playable URL for the startup file, then clears it.
func (a *API) GetInitialFile() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.initialFile == "" {
		return ""
	}
	path := a.initialFile
	a.initialFile = ""
	return LocalFileURL(a.fileServerPort, a.secret, path)
}
