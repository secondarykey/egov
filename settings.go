package egov

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type VRSettings struct {
	// InitialPitch/InitialYaw は視聴開始時の頭の向き（度）。
	// 目線の高さ合わせはカメラの平行移動ではなく回転で行う。
	InitialPitch    float64 `json:"initialPitch"`
	InitialYaw      float64 `json:"initialYaw"`
	FOV             float64 `json:"fov"`
	DragSensitivity float64 `json:"dragSensitivity"`
	ScrollSpeed     float64 `json:"scrollSpeed"`
	DefaultStart    string  `json:"defaultStart"`
}

type PlaybackSettings struct {
	Volume           float64 `json:"volume"`
	Muted            bool    `json:"muted"`
	DefaultMode      string  `json:"defaultMode"`
	ThumbnailEnabled bool    `json:"thumbnailEnabled"`
	Language         string  `json:"language"`
	ActiveColor      string  `json:"activeColor"`
}

type ControlSettings struct {
	ClickTimeoutMs       int `json:"clickTimeoutMs"`
	DoubleClickSeekSecs  int `json:"doubleClickSeekSecs"`
	FastSeekSecs         int `json:"fastSeekSecs"`
	UIHideDelayMs        int `json:"uiHideDelayMs"`
	UIHideOnLeaveDelayMs int `json:"uiHideOnLeaveDelayMs"`
}

type WindowSettings struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type AppSettings struct {
	SingleInstance      bool `json:"singleInstance"`
	AlwaysOnTop         bool `json:"alwaysOnTop"`
	AcceptInactiveClick bool `json:"acceptInactiveClick"`
	MiniProgressBar     bool `json:"miniProgressBar"`
}

type Settings struct {
	App      AppSettings      `json:"app"`
	VR       VRSettings       `json:"vr"`
	Playback PlaybackSettings `json:"playback"`
	Controls ControlSettings  `json:"controls"`
	Window   WindowSettings   `json:"window"`
}

// settingsMu serializes writes to settings.json. Wails のバインディング呼び出しは
// それぞれ別 goroutine で実行されるため、並行保存によるファイル破損を防ぐ。
var settingsMu sync.Mutex

func SaveSettings(s *Settings) error {
	settingsMu.Lock()
	defer settingsMu.Unlock()
	dir, err := settingsDir()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	// 一時ファイルに書いてから rename することで、クラッシュ時に
	// settings.json が中途半端な内容になるのを防ぐ。
	path := filepath.Join(dir, "settings.json")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func defaultSettings() *Settings {
	return &Settings{
		App: AppSettings{
			SingleInstance: false,
		},
		VR: VRSettings{
			InitialPitch:    0,
			InitialYaw:      0,
			FOV:             75,
			DragSensitivity: 0.004,
			ScrollSpeed:     0.05,
			DefaultStart:    "left",
		},
		Playback: PlaybackSettings{
			Volume:           0.5,
			DefaultMode:      "fit",
			ThumbnailEnabled: true,
			Language:         "en",
			ActiveColor:      "#4fc3f7",
		},
		Controls: ControlSettings{
			ClickTimeoutMs:       300,
			DoubleClickSeekSecs:  10,
			FastSeekSecs:         60,
			UIHideDelayMs:        1500,
			UIHideOnLeaveDelayMs: 800,
		},
	}
}

// LoadSettings loads settings.json. エラー時も nil ではなくデフォルト設定を返すため、
// 呼び出し側はエラーをログするだけでそのまま使える（ゼロ値設定で動くことはない）。
func LoadSettings() (*Settings, error) {
	s := defaultSettings()
	dir, err := settingsDir()
	if err != nil {
		return s, err
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return s, err
	}
	data, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	if err := json.Unmarshal(data, s); err != nil {
		// 部分的に上書きされた可能性があるため、新しいデフォルトを返す
		return defaultSettings(), err
	}
	return s, nil
}

// SettingsDir returns the per-user settings directory ($HOME/.egov).
func SettingsDir() (string, error) {
	return settingsDir()
}

func settingsDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".egov"), nil
}
