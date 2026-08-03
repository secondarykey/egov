package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type moduleCheck struct {
	name   string
	dir    string
	module string
}

var checks = []moduleCheck{
	{name: "egov", dir: "./_cmd/egov", module: "github.com/wailsapp/wails/v3"},
}

const (
	wailsModule = "github.com/wailsapp/wails/v3"
	// CIがインストールするCLIバージョンのピン留め先。
	// ワークフローは cat .github/variables >> $GITHUB_ENV で読み込む。
	variablesRelPath = ".github/variables"
)

func main() {
	fmt.Println("=== Wails3 Module Check ===")
	fmt.Println()

	hasError := false
	var mismatches []string

	// CIでピン留めされたバージョンがあればそれを正とする（無ければCLIを正とする）
	variablesFile, err := findVariablesFile()
	if err != nil {
		fmt.Fprintf(os.Stderr, "%-14s %v\n", "CI Build:", err)
	}

	var ciVersion string
	if variablesFile != "" {
		ciVersion, err = loadCIVersion(variablesFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "%-14s %v\n", "CI Build:", err)
		} else {
			fmt.Printf("%-14s %s\n", "CI Build:", ciVersion)
		}
	}

	cliVersion, err := getCLIVersion()
	if err != nil {
		fmt.Fprintf(os.Stderr, "%-14s %v\n", "wails3 CLI:", err)
		hasError = true
	} else {
		fmt.Printf("%-14s %s\n", "wails3 CLI:", cliVersion)
	}

	if ciVersion != "" && cliVersion != "" && ciVersion != cliVersion {
		fmt.Println()
		fmt.Printf("  WARNING: CI Build version (%s) != local CLI (%s)\n", ciVersion, cliVersion)
		fmt.Printf("  To match CI:  go install %s/cmd/wails3@%s\n", wailsModule, ciVersion)
		fmt.Printf("  To update CI: edit %s\n", variablesFile)
		hasError = true
	}

	latestVersion, err := getLatestVersion(checks[0].dir, wailsModule)
	if err != nil {
		fmt.Fprintf(os.Stderr, "latest version: %v\n", err)
	} else {
		fmt.Printf("%-14s %s\n", "latest:", latestVersion)
		if ciVersion != "" && ciVersion != latestVersion {
			fmt.Println()
			fmt.Println("CI update:")
			fmt.Printf("  1. edit %s -> WAILS_VERSION=%s\n", variablesFile, latestVersion)
			fmt.Printf("  2. go install %s/cmd/wails3@%s\n", wailsModule, latestVersion)
		} else if ciVersion == "" && cliVersion != "" && cliVersion != latestVersion {
			fmt.Println()
			fmt.Println("CLI update:")
			fmt.Printf("  go install %s/cmd/wails3@latest\n", wailsModule)
		}
	}
	fmt.Println()

	baseVersion := ciVersion
	if baseVersion == "" {
		baseVersion = cliVersion
	}

	for _, c := range checks {
		modVersion, err := getModuleVersion(c.dir, c.module)
		if err != nil {
			fmt.Fprintf(os.Stderr, "%s (%s): %v\n", c.name, c.module, err)
			hasError = true
			continue
		}
		label := fmt.Sprintf("  %s:", c.name)
		if baseVersion != "" && modVersion != baseVersion {
			fmt.Printf("%-14s %s ** MISMATCH **\n", label, modVersion)
			mismatches = append(mismatches, fmt.Sprintf("  go -C %s get %s@%s", c.dir, c.module, baseVersion))
			hasError = true
		} else {
			fmt.Printf("%-14s %s\n", label, modVersion)
		}
	}

	if len(mismatches) > 0 {
		fmt.Println()
		fmt.Println("Fix:")
		for _, m := range mismatches {
			fmt.Println(m)
		}
	}

	if hasError {
		fmt.Println()
		os.Exit(1)
	}
}

// findVariablesFile は実行位置から上位へ .github/variables を探す。
// サブディレクトリから実行してもCIバージョンのチェックを維持するため。
func findVariablesFile() (string, error) {
	base, err := filepath.Abs(".")
	if err != nil {
		return "", err
	}
	dir := base
	for {
		p := filepath.Join(dir, variablesRelPath)
		if _, err := os.Stat(p); err == nil {
			rel, err := filepath.Rel(base, p)
			if err != nil {
				return filepath.ToSlash(p), nil
			}
			return filepath.ToSlash(rel), nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("%s not found (searched upward from current directory)", variablesRelPath)
		}
		dir = parent
	}
}

// loadCIVersion は .github/variables から WAILS_VERSION を読む。
// ⚠️ ここでは # 行を読み飛ばすが、ファイル側にコメントを書いてはいけない。
// CIは cat で $GITHUB_ENV に流し込むため # 行があるとランナーが Invalid format で落ちる。
func loadCIVersion(variablesFile string) (string, error) {
	f, err := os.Open(variablesFile)
	if err != nil {
		return "", fmt.Errorf("cannot open %s: %w", variablesFile, err)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if ok && strings.TrimSpace(k) == "WAILS_VERSION" {
			return strings.TrimSpace(v), nil
		}
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	return "", fmt.Errorf("WAILS_VERSION not found in %s", variablesFile)
}

// wails3 version は stderr に出力するため CombinedOutput() を使う
func getCLIVersion() (string, error) {
	out, err := exec.Command("wails3", "version").CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to run wails3 version: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

func getLatestVersion(dir, module string) (string, error) {
	cmd := exec.Command("go", "list", "-m", "-versions", module)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to run go list -m -versions: %w", err)
	}
	parts := strings.Fields(strings.TrimSpace(string(out)))
	if len(parts) < 2 {
		return "", fmt.Errorf("no versions found")
	}
	return parts[len(parts)-1], nil
}

func getModuleVersion(dir, module string) (string, error) {
	cmd := exec.Command("go", "list", "-m", module)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to run go list -m: %w", err)
	}
	parts := strings.Fields(strings.TrimSpace(string(out)))
	if len(parts) < 2 {
		return "", fmt.Errorf("unexpected output: %s", string(out))
	}
	return parts[1], nil
}
