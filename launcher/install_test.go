package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestRuntimePromotionFailureRestoresPrevious(t *testing.T) {
	root := t.TempDir()
	destination := filepath.Join(root, "44.7.0-r2")
	os.Mkdir(destination, 0700)
	os.WriteFile(filepath.Join(destination, "working"), []byte("old"), 0600)
	original := renameRuntime
	t.Cleanup(func() { renameRuntime = original })
	renameRuntime = func(a, b string) error {
		if a == filepath.Join(root, "replacement") {
			return errors.New("disk failure")
		}
		return os.Rename(a, b)
	}
	if err := commitRuntime(root, filepath.Join(root, "replacement"), destination); err == nil {
		t.Fatal("expected failure")
	}
	if data, err := os.ReadFile(filepath.Join(destination, "working")); err != nil || string(data) != "old" {
		t.Fatal("previous runtime lost", err)
	}
}

func TestRuntimeRecoveryAfterAbruptExit(t *testing.T) {
	if root := os.Getenv("YINAMP_CRASH_TEST_ROOT"); root != "" {
		temporary, err := os.MkdirTemp(root, ".install-")
		if err != nil {
			t.Fatal(err)
		}
		expanded := filepath.Join(temporary, "runtime")
		os.Mkdir(expanded, 0700)
		os.WriteFile(filepath.Join(expanded, "new"), []byte("new"), 0600)
		renameRuntime = func(a, b string) error {
			if a == expanded {
				os.Exit(23)
			}
			return os.Rename(a, b)
		}
		_ = commitRuntime(root, expanded, filepath.Join(root, "44.7.0-r2"))
		t.Fatal("did not interrupt promotion")
	}
	root := t.TempDir()
	destination := filepath.Join(root, "44.7.0-r2")
	os.Mkdir(destination, 0700)
	os.WriteFile(filepath.Join(destination, "working"), []byte("old"), 0600)
	child := exec.Command(os.Args[0], "-test.run=^TestRuntimeRecoveryAfterAbruptExit$")
	child.Env = append(os.Environ(), "YINAMP_CRASH_TEST_ROOT="+root)
	err := child.Run()
	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() != 23 {
		t.Fatal("unexpected helper result", err)
	}
	unlock, err := lockRuntime(filepath.Join(root, "install.lock"))
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	if err := recoverRuntimeInstalls(root); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(filepath.Join(destination, "working")); err != nil || string(data) != "old" {
		t.Fatal("previous runtime not recovered", err)
	}
	partial, _ := filepath.Glob(filepath.Join(root, ".install-*"))
	if len(partial) != 0 {
		t.Fatal("orphaned setup remains", partial)
	}
}

func TestWindowFailureStopsSetupAndCleansWithoutTouchingCache(t *testing.T) {
	root := t.TempDir()
	cached := filepath.Join(root, "cached")
	os.Mkdir(cached, 0700)
	os.WriteFile(filepath.Join(cached, "working"), []byte("old"), 0600)
	data := zipBytes(t, map[string]string{"file": "runtime"})
	r := testRuntime("44.7.0", data)
	hits := 0
	serve(t, map[string][]byte{r.URL: data}, &hits)
	failed := make(chan struct{})
	noticed := make(chan struct{})
	cause := errors.New("loader crashed")
	_, err := ensureRuntimeProgress(context.Background(), root, r, func() *progressWindow {
		close(failed)
		return &progressWindow{Cancelled: failed, Failure: func() error { close(noticed); return cause }, Update: func(string, int, float64) { <-noticed }, Close: func() {}}
	})
	if !errors.Is(err, cause) {
		t.Fatal("helper failure hidden", err)
	}
	partial, _ := filepath.Glob(filepath.Join(root, ".install-*"))
	if len(partial) != 0 {
		t.Fatal("partial files remain")
	}
	if _, err := os.Stat(filepath.Join(cached, "working")); err != nil {
		t.Fatal("existing cache touched", err)
	}
}
