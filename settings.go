package egov

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type VRSettings struct {
	// InitialPitch/InitialYaw/InitialRoll は視聴開始時の頭の向き（度）。
	// Roll は素材の水平が傾いている場合の補正で、首振りでは代替できない。
	InitialPitch float64 `json:"initialPitch"`
	InitialYaw   float64 `json:"initialYaw"`
	InitialRoll  float64 `json:"initialRoll"`
	// SourceProjection は素材の投影方式。"equirect"（正距円筒）のほか、
	// 未変換のデュアル魚眼素材向けに "equidistant"（等距離）/
	// "equisolid"（等立体角）を選べる。方式が合っていないと、
	// 中央は合うのに首を振ると周辺が伸び縮みする。
	SourceProjection string `json:"sourceProjection"`
	// SourceFOV は素材の（片目分の）水平画角（度）。撮影機は 190°/200° が
	// 多く、180°決め打ちだと首振り角と画の動きが一致しない。
	SourceFOV float64 `json:"sourceFov"`
	// DisplayProjection は画面への投影方式。"rectilinear"（透視）は画面端が
	// 引き伸ばされるため、"panini" / "stereographic" を選べるようにしている。
	DisplayProjection string  `json:"displayProjection"`
	FOV               float64 `json:"fov"`
	DragSensitivity   float64 `json:"dragSensitivity"`
	ScrollSpeed       float64 `json:"scrollSpeed"`
	DefaultStart      string  `json:"defaultStart"`
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
	ClickTimeoutMs      int `json:"clickTimeoutMs"`
	DoubleClickSeekSecs int `json:"doubleClickSeekSecs"`
	// DragSeekSecs は長押しコントローラーの内側ゾーン（<< / >>）のシーク秒数。
	DragSeekSecs int `json:"dragSeekSecs"`
	FastSeekSecs int `json:"fastSeekSecs"`
	// ArrowSeekSecs は再生中の ←/→ キーによるシーク秒数（一時停止中はコマ送り）。
	ArrowSeekSecs int `json:"arrowSeekSecs"`
	// ThumbnailGridSize は Normalモードのサムネイル一覧の一辺の分割数（N×N、2..9）。
	ThumbnailGridSize    int `json:"thumbnailGridSize"`
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
			InitialPitch: 0,
			InitialYaw:   0,
			InitialRoll:  0,
			// 既定値は旧実装（180°正距円筒を透視投影）と同じ見え方になる組み合わせ。
			// ここを起点に、素材に合わせて調整する。
			SourceProjection:  "equirect",
			SourceFOV:         180,
			DisplayProjection: "rectilinear",
			FOV:               75,
			DragSensitivity:   0.004,
			ScrollSpeed:       0.05,
			DefaultStart:      "left",
		},
		Playback: PlaybackSettings{
			Volume:           0.5,
			DefaultMode:      "normal",
			ThumbnailEnabled: true,
			Language:         "en",
			ActiveColor:      "#4fc3f7",
		},
		Controls: ControlSettings{
			ClickTimeoutMs:       300,
			DoubleClickSeekSecs:  10,
			DragSeekSecs:         10,
			FastSeekSecs:         60,
			ArrowSeekSecs:        5,
			ThumbnailGridSize:    4,
			UIHideDelayMs:        1500,
			UIHideOnLeaveDelayMs: 800,
		},
	}
}

// normalize replaces zero/invalid values with defaults. 手編集や破損した
// settings.json に不正な値（0 の FOV、空のモード名等）が含まれていても、
// 呼び出し側（フロントエンド含む）がガードなしで使えるようにする。
// 既定値の定義は defaultSettings() に一元化されている。
func (s *Settings) normalize() {
	d := defaultSettings()
	if s.VR.FOV <= 0 {
		s.VR.FOV = d.VR.FOV
	}
	if s.VR.DragSensitivity <= 0 {
		s.VR.DragSensitivity = d.VR.DragSensitivity
	}
	if s.VR.ScrollSpeed <= 0 {
		s.VR.ScrollSpeed = d.VR.ScrollSpeed
	}
	if s.VR.SourceFOV < 60 || s.VR.SourceFOV > 360 {
		s.VR.SourceFOV = d.VR.SourceFOV
	}
	switch s.VR.SourceProjection {
	case "equirect", "equidistant", "equisolid":
	default:
		s.VR.SourceProjection = d.VR.SourceProjection
	}
	switch s.VR.DisplayProjection {
	case "rectilinear", "panini", "stereographic":
	default:
		s.VR.DisplayProjection = d.VR.DisplayProjection
	}
	switch s.VR.DefaultStart {
	case "left", "right", "top", "bottom":
	default:
		s.VR.DefaultStart = d.VR.DefaultStart
	}
	switch s.Playback.DefaultMode {
	case "normal", "free", "vr":
	case "fit":
		// 旧内部名からの移行: fit（ウィンドウフィット）は normal に改名された。
		// 旧 normal（自由パン/ズーム）は free に改名されたが、値が新 normal と
		// 衝突するため区別できず、旧設定はウィンドウフィット扱いになる。
		s.Playback.DefaultMode = "normal"
	default:
		s.Playback.DefaultMode = d.Playback.DefaultMode
	}
	if s.Playback.ActiveColor == "" {
		s.Playback.ActiveColor = d.Playback.ActiveColor
	}
	if s.Controls.ClickTimeoutMs <= 0 {
		s.Controls.ClickTimeoutMs = d.Controls.ClickTimeoutMs
	}
	if s.Controls.DoubleClickSeekSecs <= 0 {
		s.Controls.DoubleClickSeekSecs = d.Controls.DoubleClickSeekSecs
	}
	if s.Controls.DragSeekSecs <= 0 {
		// 旧設定からの移行: ドラッグシークは従来ダブルクリックと共用だった
		s.Controls.DragSeekSecs = s.Controls.DoubleClickSeekSecs
	}
	if s.Controls.FastSeekSecs <= 0 {
		s.Controls.FastSeekSecs = d.Controls.FastSeekSecs
	}
	if s.Controls.ArrowSeekSecs <= 0 {
		s.Controls.ArrowSeekSecs = d.Controls.ArrowSeekSecs
	}
	if s.Controls.ThumbnailGridSize < 2 || s.Controls.ThumbnailGridSize > 9 {
		s.Controls.ThumbnailGridSize = d.Controls.ThumbnailGridSize
	}
	if s.Controls.UIHideDelayMs <= 0 {
		s.Controls.UIHideDelayMs = d.Controls.UIHideDelayMs
	}
	if s.Controls.UIHideOnLeaveDelayMs <= 0 {
		s.Controls.UIHideOnLeaveDelayMs = d.Controls.UIHideOnLeaveDelayMs
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
	s.normalize()
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
