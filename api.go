package egov

import (
	"fmt"
	"net/url"
)

type API struct {
	initialFile    string
	fileServerPort int
	secret         string
	settings       *Settings
	version        string
	quitFunc       func()
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
	return *a.settings
}

// UpdatePlaybackSettings saves volume, mute, thumbnail state and language to disk.
func (a *API) UpdatePlaybackSettings(volume float64, muted bool, thumbnailEnabled bool, language string) {
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
	a.settings.VR = vr
	if err := SaveSettings(a.settings); err != nil {
		_ = err
	}
}

// UpdateControlSettings replaces the control configuration and saves to disk.
func (a *API) UpdateControlSettings(controls ControlSettings) {
	a.settings.Controls = controls
	if err := SaveSettings(a.settings); err != nil {
		_ = err
	}
}

// UpdateDefaultMode saves the default playback mode to disk.
func (a *API) UpdateDefaultMode(mode string) {
	a.settings.Playback.DefaultMode = mode
	if err := SaveSettings(a.settings); err != nil {
		_ = err
	}
}

// UpdateAlwaysOnTop saves the always-on-top state to disk.
func (a *API) UpdateAlwaysOnTop(enabled bool) {
	a.settings.App.AlwaysOnTop = enabled
	if err := SaveSettings(a.settings); err != nil {
		_ = err
	}
}

// UpdateAppSettings replaces the application configuration and saves to disk.
func (a *API) UpdateAppSettings(app AppSettings) {
	a.settings.App = app
	if err := SaveSettings(a.settings); err != nil {
		_ = err
	}
}

// UpdateActiveColor saves the UI active color to disk.
func (a *API) UpdateActiveColor(color string) {
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
	if a.initialFile == "" {
		return ""
	}
	path := a.initialFile
	a.initialFile = ""
	return fmt.Sprintf("http://127.0.0.1:%d/localfile?token=%s&path=%s",
		a.fileServerPort, a.secret, url.QueryEscape(path))
}
