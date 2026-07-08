package main

import (
	"fmt"
	"os"
	"os/exec"
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

const wailsModule = "github.com/wailsapp/wails/v3"

func main() {
	fmt.Println("=== Wails3 Module Check ===")
	fmt.Println()

	hasError := false
	var mismatches []string

	cliVersion, err := getCLIVersion()
	if err != nil {
		fmt.Fprintf(os.Stderr, "%-14s %v\n", "wails3 CLI:", err)
		hasError = true
	} else {
		fmt.Printf("%-14s %s\n", "wails3 CLI:", cliVersion)
	}

	latestVersion, err := getLatestVersion(checks[0].dir, wailsModule)
	if err != nil {
		fmt.Fprintf(os.Stderr, "latest version: %v\n", err)
	} else {
		fmt.Printf("%-14s %s\n", "latest:", latestVersion)
		if cliVersion != "" && cliVersion != latestVersion {
			fmt.Println()
			fmt.Println("CLI update:")
			fmt.Printf("  go install %s/cmd/wails3@latest\n", wailsModule)
		}
	}
	fmt.Println()

	for _, c := range checks {
		modVersion, err := getModuleVersion(c.dir, c.module)
		if err != nil {
			fmt.Fprintf(os.Stderr, "%s (%s): %v\n", c.name, c.module, err)
			hasError = true
			continue
		}
		label := fmt.Sprintf("  %s:", c.name)
		if cliVersion != "" && modVersion != cliVersion {
			fmt.Printf("%-14s %s ** MISMATCH **\n", label, modVersion)
			mismatches = append(mismatches, fmt.Sprintf("  cd %s && go get -u %s@%s && cd ../..", c.dir, c.module, cliVersion))
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
