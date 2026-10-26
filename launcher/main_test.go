package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func init() {
	progress = noProgress
	prepare = func(string) error { return nil }
}

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func testRuntime(version string, data []byte) Runtime {
	sum := sha256.Sum256(data)
	r := Runtime{Version: version, Revision: "2", SHA256: hex.EncodeToString(sum[:]), Size: int64(len(data))}
	r.URL = releases + "v" + version + "/" + runtimeName(r)
	return r
}
func zipBytes(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	for name, content := range entries {
		header := &zip.FileHeader{Name: name, Method: zip.Deflate}
		header.SetMode(0755)
		w, err := z.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		io.WriteString(w, content)
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func serve(t *testing.T, payloads map[string][]byte, hits *int) {
	t.Helper()
	original := http.DefaultTransport
	var mu sync.Mutex
	http.DefaultTransport = transport(func(r *http.Request) (*http.Response, error) {
		mu.Lock()
		defer mu.Unlock()
		data, ok := payloads[r.URL.String()]
		if !ok {
			return nil, fmt.Errorf("offline: %s", r.URL)
		}
		*hits++
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(data)), ContentLength: int64(len(data)), Request: r}, nil
	})
	t.Cleanup(func() { http.DefaultTransport = original })
}
func writeZip(t *testing.T, data []byte) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "runtime.zip")
	if err := os.WriteFile(p, data, 0600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestRuntimeManifestRejectsUnexpectedSources(t *testing.T) {
	good := testRuntime("44.7.0", []byte("runtime"))
	if err := validateRuntime(good); err != nil {
		t.Fatal(err)
	}
	cases := []Runtime{good, good, good, good, good}
	cases[0].URL = "https://evil.example/runtime.zip"
	cases[1].Version = "../../bad"
	cases[2].SHA256 = "bad"
	cases[3].Size = maxRuntime + 1
	cases[4].Revision = "3"
	for _, r := range cases {
		if validateRuntime(r) == nil {
			t.Fatalf("accepted %#v", r)
		}
	}
}
func TestInstallIsVerifiedAtomicAndReusedOffline(t *testing.T) {
	root := t.TempDir()
	relative, _ := filepath.Rel("runtime", binary("runtime"))
	data := zipBytes(t, map[string]string{filepath.ToSlash(relative): "runtime"})
	r := testRuntime("44.7.0", data)
	hits := 0
	serve(t, map[string][]byte{r.URL: data}, &hits)
	executable, err := ensureRuntime(context.Background(), root, r)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(executable); err != nil {
		t.Fatal(err)
	}
	// An installed version is reused without opening another network connection.
	for i := 0; i < 2; i++ {
		if _, err = ensureRuntime(context.Background(), root, r); err != nil {
			t.Fatal(err)
		}
	}
	if hits != 1 {
		t.Fatalf("runtime downloaded %d times", hits)
	}
	marker, err := os.ReadFile(filepath.Join(root, runtimeKey(r), "runtime.json"))
	if err != nil {
		t.Fatal(err)
	}
	var installed Runtime
	json.Unmarshal(marker, &installed)
	if installed != r {
		t.Fatal("incorrect installed runtime identity")
	}
}
func TestCorruptDownloadsNeverBecomeInstalled(t *testing.T) {
	r := testRuntime("44.7.0", []byte("expected"))
	hits := 0
	serve(t, map[string][]byte{r.URL: []byte("tampered")}, &hits)
	root := t.TempDir()
	if _, err := ensureRuntime(context.Background(), root, r); err == nil {
		t.Fatal("accepted corrupt runtime")
	}
	if _, err := os.Stat(filepath.Join(root, runtimeKey(r))); !os.IsNotExist(err) {
		t.Fatal("partial runtime became visible")
	}
}
func TestConcurrentInstallDownloadsOnlyOnce(t *testing.T) {
	relative, _ := filepath.Rel("runtime", binary("runtime"))
	data := zipBytes(t, map[string]string{filepath.ToSlash(relative): "runtime"})
	r := testRuntime("44.7.0", data)
	hits := 0
	serve(t, map[string][]byte{r.URL: data}, &hits)
	root := t.TempDir()
	var group sync.WaitGroup
	errors := make(chan error, 4)
	for i := 0; i < 4; i++ {
		group.Add(1)
		go func() { defer group.Done(); _, err := ensureRuntime(context.Background(), root, r); errors <- err }()
	}
	group.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	if hits != 1 {
		t.Fatalf("downloaded %d times", hits)
	}
}
func TestZipRejectsTraversalAndEscapingSymlinks(t *testing.T) {
	for _, name := range []string{"../outside", "/absolute", "C:/outside", `a\..\outside`} {
		t.Run(name, func(t *testing.T) {
			if err := unzip(writeZip(t, zipBytes(t, map[string]string{name: "bad"})), t.TempDir()); err == nil {
				t.Fatal("accepted unsafe path")
			}
		})
	}
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	header := &zip.FileHeader{Name: "link"}
	header.SetMode(os.ModeSymlink | 0777)
	w, _ := z.CreateHeader(header)
	io.WriteString(w, "../outside")
	z.Close()
	if err := unzip(writeZip(t, b.Bytes()), t.TempDir()); err == nil {
		t.Fatal("accepted escaping symlink")
	}
}
func TestPackPreservesExecutableAndFrameworkSymlinks(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need Windows developer permissions")
	}
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "Versions", "A"), 0755)
	os.WriteFile(filepath.Join(root, "Versions", "A", "binary"), []byte("runtime"), 0755)
	os.Symlink("A", filepath.Join(root, "Versions", "Current"))
	os.Symlink("Versions/Current/binary", filepath.Join(root, "binary"))
	archive := filepath.Join(t.TempDir(), "runtime.zip")
	if err := packRuntime(root, archive); err != nil {
		t.Fatal(err)
	}
	destination := t.TempDir()
	if err := unzip(archive, destination); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(destination, "binary"))
	if err != nil || info.Mode()&0111 == 0 {
		t.Fatal("lost executable or symlink")
	}
}
func TestCleanupKeepsRollbackAndPendingRuntimes(t *testing.T) {
	profile := t.TempDir()
	root := filepath.Join(profile, "runtimes")
	for _, version := range []string{"44.7.0", "45.0.0", "46.0.0", "47.0.0"} {
		os.MkdirAll(filepath.Join(root, version+"-r2"), 0700)
	}
	os.MkdirAll(filepath.Join(profile, "updates"), 0700)
	os.WriteFile(filepath.Join(profile, "updates", "state.json"), []byte(`{"active":"a","previous":"b","pending":"c","launch":{"healthy":true},"builds":{"a":{"electron":"45.0.0"},"b":{"electron":"44.7.0"},"c":{"electron":"46.0.0"}}}`), 0600)
	cleanup(root, profile, Runtime{Version: "44.7.0", Revision: "2"})
	for _, version := range []string{"44.7.0", "45.0.0", "46.0.0"} {
		if _, err := os.Stat(filepath.Join(root, version+"-r2")); err != nil {
			t.Fatal("removed retained runtime", version)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "47.0.0-r2")); !os.IsNotExist(err) {
		t.Fatal("obsolete runtime was not removed")
	}
}
func TestSupervisorDownloadsFirstRuntimeAndReusesIt(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture")
	}
	relative, _ := filepath.Rel("runtime", binary("runtime"))
	data := zipBytes(t, map[string]string{filepath.ToSlash(relative): "#!/bin/sh\nprintf launched >> \"${YINAMP_NATIVE_BOOTSTRAP}.log\"\n"})
	r := testRuntime("44.7.0", data)
	hits := 0
	serve(t, map[string][]byte{r.URL: data}, &hits)
	payload := []byte("application")
	sum := sha256.Sum256(payload)
	config := Config{Platform: platform(), SHA256: hex.EncodeToString(sum[:]), Runtime: r}
	args := []string{"--profile=" + t.TempDir()}
	for i := 0; i < 2; i++ {
		if err := launch(config, payload, args); err != nil {
			t.Fatal(err)
		}
	}
	if hits != 1 {
		t.Fatalf("downloaded %d times", hits)
	}
}
func TestSupervisorSwitchesRuntimeOnRequest(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture")
	}
	relative, _ := filepath.Rel("runtime", binary("runtime"))
	second := zipBytes(t, map[string]string{filepath.ToSlash(relative): "#!/bin/sh\nexit 0\n"})
	next := testRuntime("45.0.0", second)
	request, _ := json.Marshal(Request{Build: "build-123-1", Runtime: next})
	first := zipBytes(t, map[string]string{filepath.ToSlash(relative): "#!/bin/sh\ncat > \"$YINAMP_NATIVE_REQUEST\" <<'REQUEST'\n" + string(request) + "\nREQUEST\nexit 75\n"})
	initial := testRuntime("44.7.0", first)
	hits := 0
	serve(t, map[string][]byte{initial.URL: first, next.URL: second}, &hits)
	payload := []byte("application")
	sum := sha256.Sum256(payload)
	config := Config{Platform: platform(), SHA256: hex.EncodeToString(sum[:]), Runtime: initial}
	profile := t.TempDir()
	if err := launch(config, payload, []string{"--profile=" + profile}); err != nil {
		t.Fatal(err)
	}
	if hits != 2 {
		t.Fatalf("downloaded %d runtimes", hits)
	}
	hint, err := os.ReadFile(filepath.Join(profile, "launcher", config.SHA256, "runtime.json"))
	if err != nil || !strings.Contains(string(hint), "45.0.0") {
		t.Fatal("did not remember new runtime")
	}
}

func TestSupervisorFallsBackWhenNewRuntimeIsOffline(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture")
	}
	relative, _ := filepath.Rel("runtime", binary("runtime"))
	next := testRuntime("45.0.0", []byte("not available"))
	request, _ := json.Marshal(Request{Build: "build-123-1", Runtime: next})
	first := zipBytes(t, map[string]string{filepath.ToSlash(relative): "#!/bin/sh\nif [ -n \"$YINAMP_NATIVE_ERROR\" ]; then exit 0; fi\ncat > \"$YINAMP_NATIVE_REQUEST\" <<'REQUEST'\n" + string(request) + "\nREQUEST\nexit 75\n"})
	initial := testRuntime("44.7.0", first)
	hits := 0
	serve(t, map[string][]byte{initial.URL: first}, &hits)
	payload := []byte("application")
	sum := sha256.Sum256(payload)
	config := Config{Platform: platform(), SHA256: hex.EncodeToString(sum[:]), Runtime: initial}
	if err := launch(config, payload, []string{"--profile=" + t.TempDir()}); err != nil {
		t.Fatal(err)
	}
	if hits != 1 {
		t.Fatal("working runtime was downloaded again")
	}
}

// Optional native integration hook: extract the actual release ZIP using exactly
// the installer's extractor, then let the desktop harness launch that directory.
func TestReleaseRuntimeExtraction(t *testing.T) {
	source := os.Getenv("YINAMP_TEST_RUNTIME_ZIP")
	if source == "" {
		t.Skip("no release archive supplied")
	}
	destination := os.Getenv("YINAMP_TEST_RUNTIME_OUTPUT")
	if destination == "" {
		t.Fatal("missing extraction output")
	}
	if err := os.MkdirAll(destination, 0700); err != nil {
		t.Fatal(err)
	}
	if err := unzip(source, destination); err != nil {
		t.Fatal(err)
	}
	if err := prepareOfficialRuntime(destination); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS == "darwin" {
		if output, err := exec.Command("/usr/bin/codesign", "--verify", "--deep", "--strict", filepath.Join(destination, "Yinamp.app")).CombinedOutput(); err != nil {
			t.Fatalf("prepared runtime has an invalid signature: %v\n%s", err, output)
		}
	}
	if _, err := os.Stat(binary(destination)); err != nil {
		t.Fatal(err)
	}
}

func TestSupervisorFallsBackBeforeBrokenRuntimeCanStartBootstrap(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture")
	}
	for _, body := range []string{"#!/bin/sh\nexit 9\n", "not an executable"} {
		t.Run(body, func(t *testing.T) {
			relative, _ := filepath.Rel("runtime", binary("runtime"))
			broken := zipBytes(t, map[string]string{filepath.ToSlash(relative): body})
			next := testRuntime("45.0.0", broken)
			request, _ := json.Marshal(Request{Build: "build-123-1", Runtime: next})
			first := zipBytes(t, map[string]string{filepath.ToSlash(relative): "#!/bin/sh\nif [ -n \"$YINAMP_NATIVE_ERROR\" ]; then exit 0; fi\ncat > \"$YINAMP_NATIVE_REQUEST\" <<'REQUEST'\n" + string(request) + "\nREQUEST\nexit 75\n"})
			initial := testRuntime("44.7.0", first)
			hits := 0
			serve(t, map[string][]byte{initial.URL: first, next.URL: broken}, &hits)
			payload := []byte("application")
			sum := sha256.Sum256(payload)
			config := Config{Platform: platform(), SHA256: hex.EncodeToString(sum[:]), Runtime: initial}
			profile := t.TempDir()
			os.MkdirAll(filepath.Join(profile, "updates"), 0700)
			os.WriteFile(filepath.Join(profile, "updates", "state.json"), []byte(`{"launch":{"healthy":true}}`), 0600)
			// Health from an older session must not conceal a new native startup failure.
			old := time.Now().Add(-time.Hour)
			os.Chtimes(filepath.Join(profile, "updates", "state.json"), old, old)
			if err := launch(config, payload, []string{"--profile=" + profile}); err != nil {
				t.Fatal(err)
			}
			if hits != 2 {
				t.Fatal("did not try the new runtime and recover with the cached one")
			}
		})
	}
}

func TestMacBrandingOnlyChangesAppIdentity(t *testing.T) {
	original := []byte(`<plist><dict><key>CFBundleName</key><string>Electron</string><key>CFBundleDisplayName</key><string>Electron</string><key>CFBundleIdentifier</key><string>com.github.Electron</string><key>CFBundleExecutable</key><string>Electron</string></dict></plist>`)
	branded, err := brandedPlist(original)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(branded, []byte("com.kutneruri.yinamp.runtime")) || !bytes.Contains(branded, []byte("<key>CFBundleExecutable</key><string>Electron</string>")) {
		t.Fatal("identity or executable changed incorrectly")
	}
	if !bytes.Contains(original, []byte("com.github.Electron")) {
		t.Fatal("modified original metadata")
	}
	if _, err := brandedPlist([]byte("not a property list")); err == nil {
		t.Fatal("accepted unknown metadata")
	}
}

func TestSetupProgressTracksWorkAndCompletesOnlyAfterInstall(t *testing.T) {
	for _, corrupt := range []bool{false, true} {
		t.Run(fmt.Sprint(corrupt), func(t *testing.T) {
			relative, _ := filepath.Rel("runtime", binary("runtime"))
			bytes := zipBytes(t, map[string]string{filepath.ToSlash(relative): "runtime"})
			descriptor := testRuntime("44.7.0", bytes)
			served := append([]byte(nil), bytes...)
			if corrupt {
				served[0] ^= 1
			}
			hits := 0
			serve(t, map[string][]byte{descriptor.URL: served}, &hits)
			root := t.TempDir()
			var updates []progressState
			closed := false
			original := progress
			t.Cleanup(func() { progress = original })
			progress = func() *progressWindow {
				return &progressWindow{Update: func(action string, step int, percent float64) {
					updates = append(updates, progressState{action, step, percent})
					if step == 4 && percent == 100 {
						if _, err := os.Stat(filepath.Join(root, runtimeKey(descriptor), "runtime.json")); err != nil {
							t.Error("reported completion before runtime installation")
						}
					}
				}, Close: func() { closed = true }}
			}
			_, err := ensureRuntime(context.Background(), root, descriptor)
			if (err != nil) != corrupt {
				t.Fatalf("unexpected install outcome: %v", err)
			}
			if !closed {
				t.Fatal("loader was not closed")
			}
			steps := map[int]bool{}
			last := -1.0
			lastStep := 0
			for _, update := range updates {
				if update.Step < lastStep || (update.Step == lastStep && update.Percent < last) {
					t.Fatal("progress moved backwards")
				}
				if update.Step != lastStep && update.Percent != 0 {
					t.Fatal("new stage did not reset progress")
				}
				lastStep = update.Step
				last = update.Percent
				steps[update.Step] = true
			}
			if corrupt {
				if last == 100 || steps[3] || steps[4] {
					t.Fatal("corrupt download reported installation progress")
				}
				return
			}
			if last != 100 || len(steps) != 4 {
				t.Fatal("missing stage or completion")
			}
			count := len(updates)
			if _, err := ensureRuntime(context.Background(), root, descriptor); err != nil {
				t.Fatal(err)
			}
			if len(updates) != count {
				t.Fatal("cached launch unnecessarily showed a loader")
			}
		})
	}
}
