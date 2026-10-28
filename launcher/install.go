package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var runtimeDirectoryPattern = regexp.MustCompile(`^\d+\.\d+\.\d+-r[12]$`)

// All callers hold install.lock. A stopped process can leave either a disposable
// tree or a displaced cache; recover the cache before removing abandoned work.
func recoverRuntimeInstalls(root string) error {
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".previous-") {
			key := strings.TrimPrefix(name, ".previous-")
			if !runtimeDirectoryPattern.MatchString(key) {
				continue
			}
			backup := filepath.Join(root, name)
			destination := filepath.Join(root, key)
			if _, err := os.Lstat(destination); os.IsNotExist(err) {
				if err := os.Rename(backup, destination); err != nil {
					return fmt.Errorf("restore previous runtime: %w", err)
				}
			} else if err != nil {
				return err
			}
		}
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".install-") {
			if err := os.RemoveAll(filepath.Join(root, entry.Name())); err != nil {
				return fmt.Errorf("remove interrupted setup: %w", err)
			}
		}
	}
	return nil
}

var renameRuntime = os.Rename

// Never delete the displaced runtime before its replacement is committed.
// A crash between renames is repaired under the install lock on next launch.
func commitRuntime(root, expanded, destination string) error {
	backup := filepath.Join(root, ".previous-"+filepath.Base(destination))
	if _, err := os.Lstat(destination); err == nil {
		// Any existing backup has an installed successor; keep that successor intact.
		if err := os.RemoveAll(backup); err != nil {
			return err
		}
		if err := renameRuntime(destination, backup); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := renameRuntime(expanded, destination); err != nil {
		if _, exists := os.Lstat(backup); exists == nil {
			if restoreErr := renameRuntime(backup, destination); restoreErr != nil {
				return fmt.Errorf("install runtime: %v; previous runtime retained at %s; restore failed: %w", err, backup, restoreErr)
			}
		}
		return err
	}
	return nil
}
