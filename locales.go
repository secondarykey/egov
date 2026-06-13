package egov

import (
	"embed"
	"io/fs"
	"os"
	"path/filepath"
)

//go:embed internal/locales/*
var embeddedLocales embed.FS

// DistributeLocales copies embedded locale files to $HOME/.egov/locales/core/.
// languages.json is only created if it does not already exist.
func DistributeLocales() error {
	dir, err := settingsDir()
	if err != nil {
		return err
	}
	coreDir := filepath.Join(dir, "locales", "core")
	if err := os.MkdirAll(coreDir, 0755); err != nil {
		return err
	}

	entries, err := fs.ReadDir(embeddedLocales, "internal/locales")
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		data, err := embeddedLocales.ReadFile("internal/locales/" + name)
		if err != nil {
			return err
		}

		if name == "languages.json" {
			// Preserve user customization: only create if not exists
			dest := filepath.Join(dir, "locales", name)
			if _, err := os.Stat(dest); os.IsNotExist(err) {
				if err := os.WriteFile(dest, data, 0644); err != nil {
					return err
				}
			}
		} else {
			// Always overwrite core files with latest
			if err := os.WriteFile(filepath.Join(coreDir, name), data, 0644); err != nil {
				return err
			}
		}
	}
	return nil
}

// ReadLanguagesJSON returns the content of $HOME/.egov/locales/languages.json.
func ReadLanguagesJSON() ([]byte, error) {
	dir, err := settingsDir()
	if err != nil {
		return nil, err
	}
	return os.ReadFile(filepath.Join(dir, "locales", "languages.json"))
}

// IsValidLocaleCode reports whether code is a safe locale identifier
// (letters, digits, hyphen, underscore only). Rejects path separators and
// dots to prevent path traversal when building file paths from the code.
func IsValidLocaleCode(code string) bool {
	if code == "" {
		return false
	}
	for _, r := range code {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '-', r == '_':
		default:
			return false
		}
	}
	return true
}

// ReadLocaleFile returns locale data for the given language code.
// Fallback chain: user file → core file → default.json
func ReadLocaleFile(code string) ([]byte, error) {
	// 防御的バリデーション: 不正なコードはパストラバーサルになりうるため拒否。
	if !IsValidLocaleCode(code) {
		return nil, fs.ErrNotExist
	}
	dir, err := settingsDir()
	if err != nil {
		return nil, err
	}
	localesDir := filepath.Join(dir, "locales")

	if data, err := os.ReadFile(filepath.Join(localesDir, code+".json")); err == nil {
		return data, nil
	}
	coreDir := filepath.Join(localesDir, "core")
	if data, err := os.ReadFile(filepath.Join(coreDir, code+".json")); err == nil {
		return data, nil
	}
	return os.ReadFile(filepath.Join(coreDir, "default.json"))
}
