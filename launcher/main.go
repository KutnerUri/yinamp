// Yinamp's native entry point. It needs neither Electron nor Node to run.
package main

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"syscall"
	"time"
)

//go:embed assets/*
var assets embed.FS

var progress = showProgress
var prepare = prepareOfficialRuntimeContext

const releases = "https://github.com/electron/electron/releases/download/"
const runtimeRevision = "2"
const maxRuntime = 350 * 1024 * 1024

var versionPattern = regexp.MustCompile(`^\d+\.\d+\.\d+$`)

type Runtime struct {
	Version  string `json:"version"`
	Revision string `json:"revision"`
	URL      string `json:"url"`
	SHA256   string `json:"sha256"`
	Size     int64  `json:"size"`
}
type Config struct {
	ID       string  `json:"id"`
	Platform string  `json:"platform"`
	SHA256   string  `json:"sha256"`
	Runtime  Runtime `json:"runtime"`
}
type Request struct {
	Build   string  `json:"build"`
	Runtime Runtime `json:"runtime"`
}

func platform() string {
	arch := runtime.GOARCH
	if arch == "amd64" {
		arch = "x64"
	}
	system := runtime.GOOS
	if system == "windows" {
		system = "win32"
	}
	return system + "-" + arch
}
func runtimeName(r Runtime) string {
	return "electron-v" + r.Version + "-" + platform() + ".zip"
}
func validateRuntime(r Runtime) error {
	if !versionPattern.MatchString(r.Version) || r.Revision != runtimeRevision || r.Size < 1 || r.Size > maxRuntime || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(r.SHA256) || r.URL != releases+"v"+r.Version+"/"+runtimeName(r) {
		return errors.New("invalid runtime information")
	}
	return nil
}
func runtimeKey(r Runtime) string { return r.Version + "-r" + r.Revision }
func binary(root string) string {
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(root, "Yinamp.app", "Contents", "MacOS", "Electron")
	case "windows":
		return filepath.Join(root, "electron.exe")
	default:
		return filepath.Join(root, "electron")
	}
}
func profilePath(args []string) (string, error) {
	for _, arg := range args {
		if strings.HasPrefix(arg, "--profile=") {
			return filepath.Abs(strings.TrimPrefix(arg, "--profile="))
		}
	}
	var root string
	switch runtime.GOOS {
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		root = filepath.Join(home, "Library", "Application Support")
	case "windows":
		root = os.Getenv("APPDATA")
		if root == "" {
			return "", errors.New("APPDATA is unavailable")
		}
	default:
		root = os.Getenv("XDG_CONFIG_HOME")
		if root == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return "", err
			}
			root = filepath.Join(home, ".config")
		}
	}
	return filepath.Join(root, "Yinamp"), nil
}
func atomicWrite(path string, data []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".yinamp-")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if _, err = file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err = file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}
func hashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
func allowedURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil {
		return false
	}
	switch u.Host {
	case "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com":
		return true
	}
	return false
}
func download(ctx context.Context, r Runtime, destination string, updates ...func(string, int, float64)) error {
	report := func(string, int, float64) {}
	if len(updates) > 0 {
		report = updates[0]
	}
	report("Downloading Electron...", 1, 0)
	if err := validateRuntime(r); err != nil {
		return err
	}
	client := &http.Client{Timeout: 8 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 5 || !allowedURL(req.URL.String()) {
			return errors.New("unexpected runtime redirect")
		}
		return nil
	}}
	req, err := http.NewRequestWithContext(ctx, "GET", r.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Yinamp-Launcher/1")
	response, err := client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return fmt.Errorf("runtime download returned HTTP %d", response.StatusCode)
	}
	if response.ContentLength > r.Size {
		return errors.New("runtime download is too large")
	}
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer out.Close()
	h := sha256.New()
	size, err := io.Copy(io.MultiWriter(out, h, &progressWriter{Total: r.Size, Report: func(fraction float64) { report("Downloading Electron...", 1, 100*fraction) }}), io.LimitReader(response.Body, r.Size+1))
	if err != nil {
		return err
	}
	report("Checking download...", 2, 0)
	if size != r.Size || hex.EncodeToString(h.Sum(nil)) != r.SHA256 {
		return errors.New("runtime download failed its integrity check")
	}
	if err := out.Close(); err != nil {
		return err
	}
	report("Checking download...", 2, 100)
	return nil
}
func inside(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)) && !filepath.IsAbs(rel)
}
func unzip(source, destination string, updates ...func(float64)) error {
	return unzipContext(context.Background(), source, destination, updates...)
}
func unzipContext(ctx context.Context, source, destination string, updates ...func(float64)) error {
	report := func(float64) {}
	if len(updates) > 0 {
		report = updates[0]
	}
	archive, err := zip.OpenReader(source)
	if err != nil {
		return err
	}
	defer archive.Close()
	var symlinks []*zip.File
	var total uint64
	for _, entry := range archive.File {
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.UncompressedSize64 > 1500*1024*1024-total {
			return errors.New("expanded runtime is too large")
		}
		total += entry.UncompressedSize64
	}
	if err := requireSpace(filepath.Dir(destination), total); err != nil {
		return err
	}
	var extracted int64
	var expanded uint64
	for _, entry := range archive.File {
		if err := ctx.Err(); err != nil {
			return err
		}
		if strings.HasPrefix(entry.Name, "/") || filepath.IsAbs(entry.Name) || strings.Contains(entry.Name, `\`) || strings.Contains(entry.Name, ":") {
			return errors.New("invalid archive path")
		}
		target := filepath.Join(destination, filepath.FromSlash(entry.Name))
		if !inside(destination, target) {
			return errors.New("runtime archive escapes its directory")
		}
		expanded += entry.UncompressedSize64
		if expanded > 1500*1024*1024 {
			return errors.New("expanded runtime is too large")
		}
		if entry.Mode()&os.ModeSymlink != 0 {
			symlinks = append(symlinks, entry)
			continue
		}
		if entry.FileInfo().IsDir() {
			if err = os.MkdirAll(target, 0755); err != nil {
				return err
			}
			continue
		}
		if !entry.Mode().IsRegular() {
			return errors.New("unsupported runtime archive entry")
		}
		if err = os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		input, e := entry.Open()
		if e != nil {
			return e
		}
		output, e := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, entry.Mode().Perm()&0777)
		if e != nil {
			input.Close()
			return e
		}
		counter := &progressWriter{Written: extracted, Total: int64(total), Report: report}
		_, e = io.Copy(io.MultiWriter(output, counter), io.LimitReader(cancelReader{ctx, input}, 1500*1024*1024+1))
		extracted = counter.Written
		input.Close()
		closeErr := output.Close()
		if e != nil {
			return e
		}
		if closeErr != nil {
			return closeErr
		}
	}
	// Symlinks are created last, so extraction can never write through one.
	for _, entry := range symlinks {
		input, e := entry.Open()
		if e != nil {
			return e
		}
		data, e := io.ReadAll(io.LimitReader(input, 4097))
		input.Close()
		if e != nil {
			return e
		}
		link := string(data)
		target := filepath.Join(destination, filepath.FromSlash(entry.Name))
		if len(data) > 4096 || filepath.IsAbs(link) || !inside(destination, filepath.Join(filepath.Dir(target), link)) {
			return errors.New("unsafe runtime symlink")
		}
		if e = os.Symlink(link, target); e != nil {
			return e
		}
	}
	canonicalRoot, err := filepath.EvalSymlinks(destination)
	if err != nil {
		return err
	}
	for _, entry := range symlinks {
		target, err := filepath.EvalSymlinks(filepath.Join(destination, filepath.FromSlash(entry.Name)))
		if err != nil || !inside(canonicalRoot, target) {
			return errors.New("runtime symlink escapes its directory or is broken")
		}
	}
	report(1)
	return nil
}
func ensureRuntime(ctx context.Context, root string, r Runtime) (string, error) {
	return ensureRuntimeProgress(ctx, root, r, progress)
}

func ensureRuntimeProgress(ctx context.Context, root string, r Runtime, openProgress func() *progressWindow) (result string, resultErr error) {
	if err := validateRuntime(r); err != nil {
		return "", err
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return "", err
	}
	unlock, err := lockRuntime(filepath.Join(root, "install.lock"))
	if err != nil {
		return "", err
	}
	defer unlock()
	if err := recoverRuntimeInstalls(root); err != nil {
		return "", err
	}
	destination := filepath.Join(root, runtimeKey(r))
	marker := filepath.Join(destination, "runtime.json")
	var installed Runtime
	if data, e := os.ReadFile(marker); e == nil && json.Unmarshal(data, &installed) == nil && installed == r {
		if info, e := os.Stat(binary(destination)); e == nil && !info.IsDir() {
			return binary(destination), nil
		}
	}
	if err := requireSpace(root, uint64(r.Size)+1500*1024*1024); err != nil {
		return "", err
	}
	window := openProgress()
	ctx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	go func() {
		select {
		case <-window.Cancelled:
			cancel(progressStopReason(window))
		case <-ctx.Done():
		}
	}()
	defer window.Close()
	temporary, err := os.MkdirTemp(root, ".install-")
	if err != nil {
		return "", err
	}
	defer func() {
		var cleanupErr error
		if ctx.Err() != nil {
			resultErr = context.Cause(ctx)
			cleanupErr = cleanupSetup(temporary, window.Update)
		} else {
			cleanupErr = os.RemoveAll(temporary)
		}
		if err := cleanupErr; err != nil {
			resultErr = fmt.Errorf("setup stopped (%v), but temporary files could not be removed: %w", resultErr, err)
		}
	}()
	archive := filepath.Join(temporary, "runtime.zip")
	if err = download(ctx, r, archive, window.Update); err != nil {
		return "", err
	}
	expanded := filepath.Join(temporary, "runtime")
	if err = os.Mkdir(expanded, 0700); err != nil {
		return "", err
	}
	window.Update("Unpacking Electron...", 3, 0)
	if err = unzipContext(ctx, archive, expanded, func(fraction float64) { window.Update("Unpacking Electron...", 3, 100*fraction) }); err != nil {
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	window.Update("Preparing Yinamp...", 4, 0)
	if err = prepare(ctx, expanded); err != nil {
		return "", err
	}
	if _, err = os.Stat(binary(expanded)); err != nil {
		return "", errors.New("runtime executable is missing")
	}
	data, _ := json.Marshal(r)
	if err = atomicWrite(filepath.Join(expanded, "runtime.json"), data); err != nil {
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if err = commitRuntime(root, expanded, destination); err != nil {
		return "", err
	}
	window.Update("Preparing Yinamp...", 4, 100)
	return binary(destination), nil
}
func environment(values map[string]string) []string {
	result := []string{}
	for _, value := range os.Environ() {
		key := strings.SplitN(value, "=", 2)[0]
		if key == "ELECTRON_RUN_AS_NODE" || strings.HasPrefix(key, "YINAMP_NATIVE_") {
			continue
		}
		result = append(result, value)
	}
	for key, value := range values {
		result = append(result, key+"="+value)
	}
	return result
}
func run() error {
	data, err := assets.ReadFile("assets/config.json")
	if err != nil {
		return err
	}
	var config Config
	if err = json.Unmarshal(data, &config); err != nil {
		return err
	}
	payload, err := assets.ReadFile("assets/app.asar")
	if err != nil {
		return err
	}
	return launch(config, payload, os.Args[1:])
}
func launch(config Config, payload []byte, args []string) error {
	signals, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()
	ctx, cancel := context.WithCancelCause(signals)
	defer cancel(nil)
	if config.Platform != platform() {
		return errors.New("this download is for a different operating system or processor")
	}
	if err := validateRuntime(config.Runtime); err != nil {
		return err
	}
	profile, err := profilePath(args)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(profile, 0700); err != nil {
		return err
	}
	// GUI launchers on Windows may have no standard handles. Give Electron a
	// real log file rather than inheriting an invalid console handle.
	log, err := os.OpenFile(filepath.Join(profile, "launcher.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return err
	}
	defer log.Close()
	if info, e := log.Stat(); e == nil && info.Size() > 4*1024*1024 {
		_ = log.Truncate(0)
	}
	base := filepath.Join(profile, "launcher", config.SHA256)
	if err = os.MkdirAll(base, 0700); err != nil {
		return err
	}
	archive := filepath.Join(base, "app.asar")
	if sum, _ := hashFile(archive); sum != config.SHA256 {
		if err := requireSpace(base, uint64(len(payload))); err != nil {
			return err
		}
		if err = atomicWrite(archive, payload); err != nil {
			return err
		}
		if sum, e := hashFile(archive); e != nil || sum != config.SHA256 {
			return errors.New("bundled application is damaged")
		}
	}
	runtimeRoot := filepath.Join(profile, "runtimes")
	current := config.Runtime
	// This hint only saves a bootstrap handoff. The bootstrap remains authoritative.
	if hint, e := os.ReadFile(filepath.Join(base, "runtime.json")); e == nil {
		var r Runtime
		if json.Unmarshal(hint, &r) == nil && validateRuntime(r) == nil {
			current = r
		}
	}
	session, err := os.MkdirTemp(profile, ".launch-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(session)
	requestPath := filepath.Join(session, "request.json")
	runtimeFailure := ""
	var loader *progressWindow
	defer func() {
		if loader != nil {
			loader.Close()
		}
	}()
	openLoader := func() *progressWindow {
		if loader == nil {
			loader = progress()
			currentLoader := loader
			signal := currentLoader.Cancelled
			go func() {
				select {
				case <-signal:
					cancel(progressStopReason(currentLoader))
				case <-ctx.Done():
				}
			}()
		}
		// Keep the native UI through runtime startup, until the player is visible.
		return &progressWindow{Update: loader.Update, Close: func() {}, Cancelled: loader.Cancelled, Failure: loader.Failure}
	}
	for attempt := 0; ; attempt++ {
		if attempt >= 8 {
			return errors.New("Yinamp could not select a working runtime; please reopen it")
		}
		executable, e := ensureRuntimeProgress(ctx, runtimeRoot, current, openLoader)
		if e != nil {
			if ctx.Err() != nil {
				return e
			}
			if current != config.Runtime {
				runtimeFailure = "runtime download failed: " + e.Error()
				current = config.Runtime
				continue
			}
			return e
		}
		os.Remove(requestPath)
		readyPath := filepath.Join(session, "ready")
		os.Remove(readyPath)
		if loader != nil {
			loader.Update("Opening Yinamp...", 5, 0)
		}
		child := exec.CommandContext(ctx, executable, append([]string{archive, "--profile=" + profile}, args...)...)
		child.Env = environment(map[string]string{"YINAMP_NATIVE_READY": readyPath, "YINAMP_NATIVE_BOOTSTRAP": archive, "YINAMP_NATIVE_REQUEST": requestPath, "YINAMP_NATIVE_ERROR": runtimeFailure, "YINAMP_NATIVE_UNINSTALL": uninstallAvailable(profile), "YINAMP_NATIVE_UNINSTALL_HELPER": uninstallHelper(profile)})
		child.Stdout = log
		child.Stderr = log
		startedAt := time.Now()
		done := make(chan struct{})
		watched := make(chan struct{})
		go func() {
			defer close(watched)
			if loader == nil {
				return
			}
			ticker := time.NewTicker(40 * time.Millisecond)
			defer ticker.Stop()
			// Older app archives may not acknowledge visibility. Bound that wait.
			timeout := time.NewTimer(30 * time.Second)
			defer timeout.Stop()
			for {
				select {
				case <-done:
					return
				case <-timeout.C:
					loader.Close()
					return
				case <-ticker.C:
					if _, e := os.Stat(readyPath); e == nil {
						loader.Close()
						return
					}
				}
			}
		}()
		err = child.Run()
		close(done)
		<-watched
		if ctx.Err() != nil {
			return context.Cause(ctx)
		}
		if loader != nil {
			loader.Close()
			loader = nil
		}
		code := 0
		if err != nil {
			var exit *exec.ExitError
			if !errors.As(err, &exit) {
				if current != config.Runtime {
					runtimeFailure = "desktop runtime could not be opened: " + err.Error()
					current = config.Runtime
					continue
				}
				return err
			}
			code = exit.ExitCode()
		}
		if code == 78 && uninstallAvailable(profile) == "1" {
			return uninstall(profile)
		}
		if code == 75 {
			raw, e := os.ReadFile(requestPath)
			if e != nil {
				return e
			}
			var request Request
			if e = json.Unmarshal(raw, &request); e != nil {
				return e
			}
			if e = validateRuntime(request.Runtime); e != nil {
				return e
			}
			current = request.Runtime
			runtimeFailure = ""
			continue
		}
		if code == 76 {
			if healthySince(profile, startedAt) {
				attempt = 0
			}
			runtimeFailure = ""
			continue
		}
		if code == 77 {
			args = append(args, "--yinamp-bundled")
			current = config.Runtime
			runtimeFailure = ""
			continue
		}
		if code != 0 && current != config.Runtime && !healthySince(profile, startedAt) {
			// A runtime can fail before JavaScript starts (OS policy, loader or
			// native crash). Recover through the retained bootstrap runtime.
			runtimeFailure = fmt.Sprintf("desktop runtime failed to start (status %d)", code)
			current = config.Runtime
			continue
		}
		// Only a healthy launch may prune runtimes needed by older builds.
		cleanup(runtimeRoot, profile, config.Runtime)
		hint, _ := json.Marshal(current)
		_ = atomicWrite(filepath.Join(base, "runtime.json"), hint)
		if code != 0 {
			return fmt.Errorf("Yinamp exited with status %d", code)
		}
		return nil
	}
}
func healthySince(profile string, startedAt time.Time) bool {
	info, err := os.Stat(filepath.Join(profile, "updates", "state.json"))
	return err == nil && !info.ModTime().Before(startedAt) && healthyProfile(profile)
}
func healthyProfile(profile string) bool {
	raw, err := os.ReadFile(filepath.Join(profile, "updates", "state.json"))
	var state struct{ Launch struct{ Healthy bool } }
	return err == nil && json.Unmarshal(raw, &state) == nil && state.Launch.Healthy
}
func cleanup(root, profile string, bundled Runtime) {
	raw, err := os.ReadFile(filepath.Join(profile, "updates", "state.json"))
	if err != nil {
		return
	}
	var state struct {
		Active, Previous, Pending, Pinned string
		Launch                            struct{ Healthy bool }
		Builds                            map[string]struct{ Electron string }
	}
	if json.Unmarshal(raw, &state) != nil || !state.Launch.Healthy {
		return
	}
	keep := map[string]bool{runtimeKey(bundled): true}
	for _, id := range []string{state.Active, state.Previous, state.Pending, state.Pinned} {
		if build, ok := state.Builds[id]; ok && versionPattern.MatchString(build.Electron) {
			keep[build.Electron+"-r"+runtimeRevision] = true
		}
	}
	unlock, err := lockRuntime(filepath.Join(root, "install.lock"))
	if err != nil {
		return
	}
	defer unlock()
	entries, _ := os.ReadDir(root)
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".previous-") {
			key := strings.TrimPrefix(entry.Name(), ".previous-")
			if runtimeDirectoryPattern.MatchString(key) {
				if _, err := os.Stat(filepath.Join(root, key, "runtime.json")); err == nil {
					_ = os.RemoveAll(filepath.Join(root, entry.Name()))
				}
			}
		}
		if entry.IsDir() && runtimeDirectoryPattern.MatchString(entry.Name()) && !keep[entry.Name()] {
			_ = os.RemoveAll(filepath.Join(root, entry.Name()))
		}
	}
}
func main() {
	if err := run(); err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		fmt.Fprintln(os.Stderr, err)
		showError(err.Error())
		os.Exit(1)
	}
}

// Stop extraction promptly even within a large archive entry.
type cancelReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r cancelReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}

// Drain the meter as the disposable installation tree is removed.
func cleanupSetup(root string, report func(string, int, float64)) error {
	var paths []string
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		paths = append(paths, path)
		return nil
	})
	if err != nil {
		return err
	}
	report("Cleaning up temporary files...", 6, 100)
	for i := len(paths) - 1; i >= 0; i-- {
		if err := os.Remove(paths[i]); err != nil && !os.IsNotExist(err) {
			return err
		}
		report("Cleaning up temporary files...", 6, 100*float64(i)/float64(len(paths)))
	}
	return nil
}
