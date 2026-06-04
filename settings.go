package egov

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type VROffsetXYZ struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

type VROffsets struct {
	Left   VROffsetXYZ `json:"left"`
	Right  VROffsetXYZ `json:"right"`
	Top    VROffsetXYZ `json:"top"`
	Bottom VROffsetXYZ `json:"bottom"`
}

type VRSettings struct {
	Offsets         VROffsets `json:"offsets"`
	FOV             float64   `json:"fov"`
	DragSensitivity float64   `json:"dragSensitivity"`
	ScrollSpeed     float64   `json:"scrollSpeed"`
	DefaultStart    string    `json:"defaultStart"`
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

func SaveSettings(s *Settings) error {
	dir, err := settingsDir()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "settings.json"), data, 0644)
}

func defaultSettings() *Settings {
	offset := VROffsetXYZ{X: 0, Y: 0, Z: 0.1}
	return &Settings{
		App: AppSettings{
			SingleInstance: false,
		},
		VR: VRSettings{
			Offsets: VROffsets{
				Left:   offset,
				Right:  offset,
				Top:    offset,
				Bottom: offset,
			},
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

func LoadSettings() (*Settings, error) {
	dir, err := settingsDir()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}
	s := defaultSettings()
	data, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, s); err != nil {
		return nil, err
	}
	return s, nil
}

func settingsDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".egov"), nil
}
