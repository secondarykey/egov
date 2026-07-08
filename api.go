package egov

import (
	"fmt"
	"net/url"
	"sync"
)

// LocalFileURL builds a playable URL for path on the local file server.
func LocalFileURL(port int, secret, path string) string {
	return fmt.Sprintf("http://127.0.0.1:%d/localfile?token=%s&path=%s",
		port, secret, url.QueryEscape(path))
}

type API struct {
	// mu guards settings/initialFile. バインディング呼び出しは並行に実行されうる。
	mu             sync.Mutex
	initialFile    string
	fileServerPort int
	secret         string
	settings       *Settings
	version        string
	quitFunc       func() `json:"-"`
}

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

// UpdatePlaybackSettings saves volume, mute, thumbnail state and language to disk.
func (a *API) UpdatePlaybackSettings(volume float64, muted bool, thumbnailEnabled bool, language string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.settings.Playback.Volume = volume
	a.settings.Playback.Muted = muted
	a.settings.Playback.ThumbnailEnabled = thumbnailEnabled
	a.settings.Playback.Language = language
	if err := SaveSettings(a.settings); err != nil {
		// 保存失敗はサイレントに無視（次回起動時にデフォルト値になるだけ）
		_ = err
	}
}

// UpdateVRSettings replaces the VR configuration and saves to disk.
func (a *API) UpdateVRSettings(vr VRSettings) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.settings.VR = vr
	if err := SaveSettings(a.settings); err != nil {
		_ = err
	}
}

// UpdateControlSettings replaces the control configuration and saves to disk.
func (a *API) UpdateControlSettings(controls ControlSettings) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.settings.Controls = controls
	if err := SaveSettings(a.settings); err != nil {
		_ = err
	}
}

// UpdateDefaultMode saves the default playback mode to disk.
func (a *API) UpdateDefaultMode(mode string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.settings.Playback.DefaultMode = mode
	if err := SaveSettings(a.settings); err != nil {
		_ = err
	}
}

// UpdateAlwaysOnTop saves the always-on-top state to disk.
func (a *API) UpdateAlwaysOnTop(enabled bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.settings.App.AlwaysOnTop = enabled
	if err := SaveSettings(a.settings); err != nil {
		_ = err
	}
}

// UpdateAppSettings replaces the application configuration and saves to disk.
func (a *API) UpdateAppSettings(app AppSettings) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.settings.App = app
	if err := SaveSettings(a.settings); err != nil {
		_ = err
	}
}

// UpdateActiveColor saves the UI active color to disk.
func (a *API) UpdateActiveColor(color string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.settings.Playback.ActiveColor = color
	if err := SaveSettings(a.settings); err != nil {
		_ = err
	}
}

// SetQuitFunc sets the function called by Quit() to save state and exit.
func (a *API) SetQuitFunc(f func()) {
	a.quitFunc = f
}

// Quit saves the window state and exits the application.
func (a *API) Quit() {
	if a.quitFunc != nil {
		a.quitFunc()
	}
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
