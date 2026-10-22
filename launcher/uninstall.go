package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Resolve only the installed launcher bundle, never the cached Electron bundle.
func launcherBundle(executable string) (string, error) {
	directory := filepath.Dir(executable)
	contents := filepath.Dir(directory)
	bundle := filepath.Dir(contents)
	if filepath.Base(directory) != "MacOS" || filepath.Base(contents) != "Contents" || !strings.HasSuffix(bundle, ".app") {
		return "", errors.New("uninstall is available only from the installed Yinamp app")
	}
	return bundle, nil
}

func uninstallAvailable(profile string) string {
	if runtime.GOOS != "darwin" {
		return ""
	}
	expected, err := profilePath(nil)
	if err != nil || filepath.Clean(profile) != filepath.Clean(expected) {
		return ""
	}
	executable, err := os.Executable()
	if err != nil {
		return ""
	}
	if _, err = launcherBundle(executable); err != nil {
		return ""
	}
	return "1"
}

func uninstallHelper(profile string) string {
	if uninstallAvailable(profile) != "1" {
		return ""
	}
	executable, err := os.Executable()
	if err != nil {
		return ""
	}
	bundle, err := launcherBundle(executable)
	if err != nil {
		return ""
	}
	return filepath.Join(bundle, "Contents", "Helpers", "Yinamp Loader.app", "Contents", "MacOS", "Yinamp Loader")
}

func uninstall(profile string) error {
	if uninstallAvailable(profile) != "1" {
		return errors.New("cannot uninstall this Yinamp installation")
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	bundle, err := launcherBundle(executable)
	if err != nil {
		return err
	}
	helper := uninstallHelper(profile)
	// Electron has exited; the helper can now move both the runtime and this
	// running launcher's bundle to Trash without an external cleanup service.
	return exec.Command(helper, "--uninstall", profile, bundle).Run()
}
