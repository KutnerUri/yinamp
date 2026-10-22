package main

import "testing"

func TestLauncherBundleRejectsUnrelatedPaths(t *testing.T) {
	for _, path := range []string{"/Applications/Yinamp.app/Contents/MacOS/Yinamp", "/tmp/Yinamp.app/Contents/MacOS/Yinamp"} {
		if _, err := launcherBundle(path); err != nil {
			t.Fatal(err)
		}
	}
	for _, path := range []string{"/usr/bin/yinamp", "/Applications/Yinamp/Contents/MacOS/Yinamp", "/Applications/Yinamp.app/Yinamp"} {
		if _, err := launcherBundle(path); err == nil {
			t.Fatalf("accepted unrelated path %s", path)
		}
	}
	if uninstallAvailable(t.TempDir()) != "" {
		t.Fatal("offered uninstall for a temporary profile")
	}
}
