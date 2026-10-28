package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestInsufficientSpaceStopsBeforeDownload(t *testing.T) {
	original := diskAvailable
	t.Cleanup(func() { diskAvailable = original })
	diskAvailable = func(string) (uint64, error) { return 1, nil }
	root := t.TempDir()
	r := testRuntime("44.7.0", []byte("archive"))
	opened := false
	_, err := ensureRuntimeProgress(context.Background(), root, r, func() *progressWindow { opened = true; return noProgress() })
	if err == nil || opened {
		t.Fatal("setup proceeded without sufficient space", err)
	}
	entries, _ := os.ReadDir(root)
	for _, entry := range entries {
		if entry.Name() != "install.lock" {
			t.Fatal("left partial installation", entry.Name())
		}
	}
}

func TestCancelDuringDownloadCleansTemporaryFiles(t *testing.T) {
	data := zipBytes(t, map[string]string{"file": "runtime"})
	r := testRuntime("44.7.0", data)
	hits := 0
	serve(t, map[string][]byte{r.URL: data}, &hits)
	root := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, err := ensureRuntimeProgress(ctx, root, r, func() *progressWindow {
		return &progressWindow{Update: func(string, int, float64) { cancel() }, Close: func() {}}
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatal("expected cancellation", err)
	}
	partial, _ := filepath.Glob(filepath.Join(root, ".install-*"))
	if len(partial) != 0 {
		t.Fatal("partial files remain", partial)
	}
}

func TestExtractionHonorsCancellation(t *testing.T) {
	root := t.TempDir()
	archive := filepath.Join(root, "archive.zip")
	os.WriteFile(archive, zipBytes(t, map[string]string{"file": "runtime"}), 0600)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := unzipContext(ctx, archive, filepath.Join(root, "expanded")); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestCleanupDrainsMeterAndRemovesOnlyTemporaryTree(t *testing.T) {
	root := t.TempDir()
	temporary := filepath.Join(root, "partial")
	os.MkdirAll(filepath.Join(temporary, "nested"), 0700)
	os.WriteFile(filepath.Join(temporary, "nested", "file"), []byte("partial"), 0600)
	cached := filepath.Join(root, "cached")
	os.WriteFile(cached, []byte("working"), 0600)
	last := 101.0
	reports := 0
	if err := cleanupSetup(temporary, func(_ string, step int, percent float64) {
		if step != 6 || percent > last {
			t.Fatal("cleanup meter did not drain", step, percent, last)
		}
		last = percent
		reports++
	}); err != nil {
		t.Fatal(err)
	}
	if last != 0 || reports < 2 {
		t.Fatal("missing cleanup progress")
	}
	if _, err := os.Stat(temporary); !os.IsNotExist(err) {
		t.Fatal("temporary tree remains")
	}
	if _, err := os.Stat(cached); err != nil {
		t.Fatal("cached runtime touched", err)
	}
}
