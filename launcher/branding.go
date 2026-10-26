package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
)

func brandedPlist(data []byte) ([]byte, error) {
	for key, value := range map[string]string{"CFBundleName": "Yinamp", "CFBundleDisplayName": "Yinamp", "CFBundleIdentifier": "com.kutneruri.yinamp.runtime"} {
		pattern := regexp.MustCompile(`(<key>` + key + `</key>\s*<string>)[^<]*(</string>)`)
		if !pattern.Match(data) {
			return nil, fmt.Errorf("Electron metadata is missing %s", key)
		}
		data = pattern.ReplaceAll(data, []byte("${1}"+value+"${2}"))
	}
	return data, nil
}

// Verify the official ZIP first; only the private installed macOS copy is branded.
// The executable and frameworks remain official Electron binaries. No certificate
// or developer tools are needed: codesign is part of macOS and uses an ad-hoc signature.
func prepareOfficialRuntime(root string) error {
	if runtime.GOOS != "darwin" {
		return nil
	}
	source := filepath.Join(root, "Electron.app")
	destination := filepath.Join(root, "Yinamp.app")
	if err := os.Rename(source, destination); err != nil {
		return err
	}
	plist := filepath.Join(destination, "Contents", "Info.plist")
	data, err := os.ReadFile(plist)
	if err != nil {
		return err
	}
	data, err = brandedPlist(data)
	if err != nil {
		return err
	}
	if err = os.WriteFile(plist, data, 0644); err != nil {
		return err
	}
	// Reuse the installed launcher's icon without embedding a second large copy.
	if executable, e := os.Executable(); e == nil {
		icon := filepath.Join(filepath.Dir(executable), "..", "Resources", "icon.icns")
		if bytes, e := os.ReadFile(icon); e == nil {
			if e = os.WriteFile(filepath.Join(destination, "Contents", "Resources", "electron.icns"), bytes, 0644); e != nil {
				return e
			}
		}
	}
	// Intel archives can contain unsigned nested helpers. Prepare the entire
	// private runtime tree with ad-hoc signatures, including those helpers.
	output, err := exec.Command("/usr/bin/codesign", "--force", "--deep", "--sign", "-", destination).CombinedOutput()
	if err != nil {
		return errors.New("could not prepare the Electron app: " + string(output))
	}
	return nil
}
