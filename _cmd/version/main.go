package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

const (
	versionFile = "./_cmd/egov/version"
	configYml   = "./_cmd/egov/build/config.yml"
	configRg    = `^\s*version:\s*"([0-9]+\.[0-9]+\.[0-9]+)"`
	configFmt   = `  version: "%v"`
	packJsn     = "./_cmd/egov/frontend/package.json"
	packRg      = `^\s*"version":\s*"([0-9]+\.[0-9]+\.[0-9]+)"`
	packFmt     = `  "version": "%v",`
)

const inqury = `
Now Version: %s

  Enter   -> Patch Version
  1:Patch -> %s
  2:Minor -> %s
  3:Major -> %s
  Other   -> Cancel

Please select the upgrade version(1-3)[1]:`

type ver struct {
	major int
	minor int
	patch int
}

func parseVer(v string) *ver {

	var rtn ver
	rtn.major = -1
	rtn.minor = -1
	rtn.patch = -1

	vals := strings.Split(v, ".")
	if len(vals) == 3 {
		rtn.major = parseInt(vals[0])
		rtn.minor = parseInt(vals[1])
		rtn.patch = parseInt(vals[2])
	}

	return &rtn
}

func parseInt(v string) int {
	val, err := strconv.Atoi(v)
	if err != nil {
		return -1
	}
	return val
}

func (v ver) addMajor() *ver {
	var rtn ver
	rtn.major = v.major + 1
	rtn.minor = 0
	rtn.patch = 0
	return &rtn
}

func (v ver) addMinor() *ver {
	var rtn ver
	rtn.major = v.major
	rtn.minor = v.minor + 1
	rtn.patch = 0
	return &rtn
}

func (v ver) addPatch() *ver {
	var rtn ver
	rtn.major = v.major
	rtn.minor = v.minor
	rtn.patch = v.patch + 1
	return &rtn
}

func (v ver) String() string {
	return fmt.Sprintf("%d.%d.%d", v.major, v.minor, v.patch)
}

func (v *ver) isError() bool {
	if v == nil {
		return true
	}
	if v.major == -1 {
		return true
	}
	return false
}

var bump bool

func main() {

	flag.BoolVar(&bump, "bump", false, "対話的にバージョンを選択して更新")
	flag.Parse()

	args := flag.Args()

	err := run(args)
	if err != nil {
		fmt.Fprintf(os.Stderr, "run() error: %+v", err)
		os.Exit(1)
	}

	fmt.Println("Success")
}

func run(args []string) error {

	now, err := parseVersion()
	if err != nil {
		return err
	}

	// 引数なし・フラグなし: version ファイルのバージョンで他ファイルを同期
	if len(args) == 0 && !bump {
		fmt.Println("Version:", now)
		return write(now)
	}

	var rtn *ver

	if bump {
		// -bump: 対話的にバージョンを選択
		rtn = inquryVersion(now)
	} else {
		// 引数指定: 指定バージョンを設定
		rtn = parseVer(args[0])
	}

	if rtn.isError() {
		return fmt.Errorf("input version error")
	}

	fmt.Println("Version:", rtn)

	// version ファイルに書き込み
	if err := os.WriteFile(versionFile, []byte(rtn.String()), 0644); err != nil {
		return err
	}
	fmt.Println("Write:", versionFile)

	return write(rtn)
}

func inquryVersion(now *ver) *ver {

	major := now.addMajor()
	minor := now.addMinor()
	patch := now.addPatch()

	fmt.Fprintf(os.Stdout, inqury,
		now.String(), patch.String(), minor.String(), major.String())

	scanner := bufio.NewScanner(os.Stdin)
	scanner.Scan()

	str := scanner.Text()

	var rtn *ver
	if str == "" || str == "1" {
		rtn = patch
	} else if str == "2" {
		rtn = minor
	} else if str == "3" {
		rtn = major
	}
	return rtn
}

func parseVersion() (*ver, error) {

	data, err := os.ReadFile(versionFile)
	if err != nil {
		return nil, err
	}

	v := parseVer(strings.TrimSpace(string(data)))
	return v, nil
}

type op struct {
	input  string
	output string
	v      *ver
	rgs    []*rgSet
}

type rgSet struct {
	xp     string
	format string
	rg     *regexp.Regexp
}

func write(v *ver) error {

	ops := []*op{
		{configYml, "", v, []*rgSet{{configRg, configFmt, nil}}},
		{packJsn, "", v, []*rgSet{{packRg, packFmt, nil}}},
	}

	for _, o := range ops {
		err := writeFile(o)
		if err != nil {
			return err
		}
	}

	for _, o := range ops {
		if err := os.Rename(o.output, o.input); err != nil {
			return fmt.Errorf("rename %s -> %s: %w", o.output, o.input, err)
		}
		fmt.Println("Rename:", o.input)
	}

	return nil
}

func writeFile(o *op) error {

	for _, set := range o.rgs {
		rg := regexp.MustCompile(set.xp)
		set.rg = rg
	}

	in, err := os.Open(o.input)
	if err != nil {
		return err
	}
	defer in.Close()

	output := o.input + "_tmp"
	o.output = output

	fmt.Println("Write temp:", output)

	out, err := os.Create(output)
	if err != nil {
		return err
	}
	defer out.Close()

	scanner := bufio.NewScanner(in)

	for scanner.Scan() {

		line := scanner.Text()

		for _, set := range o.rgs {
			match := set.rg.FindStringSubmatch(line)
			if len(match) > 1 {
				line = fmt.Sprintf(set.format, o.v)
				break
			}
		}

		fmt.Fprintln(out, line)
	}

	if err := scanner.Err(); err != nil {
		return err
	}

	return nil
}
