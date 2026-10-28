package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

//go:embed ui/progress-windows.ps1
var progressScripts embed.FS

type progressWindow struct {
	Update    func(string, int, float64)
	Close     func()
	Cancelled <-chan struct{}
	Failure   func() error
}
type progressState struct {
	Action  string  `json:"action"`
	Step    int     `json:"step"`
	Percent float64 `json:"percent"`
}

func noProgress() *progressWindow {
	return &progressWindow{Update: func(string, int, float64) {}, Close: func() {}}
}
func progressCommand(path string) *exec.Cmd {
	switch runtime.GOOS {
	case "darwin":
		executable, err := os.Executable()
		if err != nil {
			return exec.Command("/nonexistent-yinamp-loader")
		}
		helper := filepath.Join(filepath.Dir(executable), "..", "Helpers", "Yinamp Loader.app", "Contents", "MacOS", "Yinamp Loader")
		return exec.Command(helper, path)
	case "windows":
		script, _ := progressScripts.ReadFile("ui/progress-windows.ps1")
		command := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", string(script))
		command.Env = append(os.Environ(), "YINAMP_PROGRESS_FILE="+path)
		return command
	default:
		command := exec.Command("zenity", "--progress", "--title=Yinamp", "--text=Downloading Electron...  1/5", "--width=360", "--percentage=0")
		command.Env = append(os.Environ(), "GTK_THEME=Adwaita:dark")
		return command
	}
}
func showProgress() *progressWindow {
	if os.Getenv("YINAMP_LAUNCHER_NO_UI") == "1" {
		return noProgress()
	}
	directory, err := os.MkdirTemp("", "yinamp-progress-")
	if err != nil {
		return failedProgress(err)
	}
	path := filepath.Join(directory, "progress.json")
	data, _ := json.Marshal(progressState{"Downloading Electron...", 1, 0})
	if err = os.WriteFile(path, data, 0600); err != nil {
		os.RemoveAll(directory)
		return failedProgress(err)
	}
	command := progressCommand(path)
	input, err := command.StdinPipe()
	if err != nil {
		os.RemoveAll(directory)
		return failedProgress(err)
	}
	if err = command.Start(); err != nil {
		input.Close()
		os.RemoveAll(directory)
		return failedProgress(err)
	}
	var mutex sync.Mutex
	last := time.Time{}
	lastStep := 0
	closed := false
	cancelled := make(chan struct{})
	var cancelOnce sync.Once
	signalCancel := func() { cancelOnce.Do(func() { close(cancelled) }) }
	exited := make(chan struct{})
	var failure error
	go func() {
		waitErr := command.Wait()
		mutex.Lock()
		if !closed {
			_, cancelErr := os.Stat(path + ".cancel")
			// Zenity uses exit 1 for Cancel/window close. Native helpers use the file.
			explicit := cancelErr == nil || (runtime.GOOS == "linux" && command.ProcessState.ExitCode() == 1)
			if !explicit {
				failure = errors.New("setup window closed unexpectedly")
				if waitErr != nil {
					failure = fmt.Errorf("setup window failed: %w", waitErr)
				}
			}
			signalCancel()
		}
		mutex.Unlock()
		close(exited)
	}()
	go func() {
		ticker := time.NewTicker(40 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-exited:
				return
			case <-ticker.C:
				if _, err := os.Stat(path + ".cancel"); err == nil {
					signalCancel()
					return
				}
			}
		}
	}()
	return &progressWindow{
		Cancelled: cancelled,
		Failure:   func() error { mutex.Lock(); defer mutex.Unlock(); return failure },
		Update: func(action string, step int, percent float64) {
			mutex.Lock()
			defer mutex.Unlock()
			if closed {
				return
			}
			percent = math.Max(0, math.Min(100, percent))
			if step == lastStep && percent > 0 && percent < 100 && time.Since(last) < 80*time.Millisecond {
				return
			}
			last = time.Now()
			lastStep = step
			if runtime.GOOS == "linux" {
				_, _ = fmt.Fprintf(input, "%d\n# %s  %d/5\n", int(percent), action, step)
				return
			}
			data, _ := json.Marshal(progressState{action, step, percent})
			_ = atomicWrite(path, data)
		},
		Close: func() {
			mutex.Lock()
			if closed {
				mutex.Unlock()
				return
			}
			closed = true
			_ = input.Close()
			_ = command.Process.Kill()
			mutex.Unlock()
			<-exited
			_ = os.RemoveAll(directory)
		},
	}
}

// Reports actual streamed bytes; visual updates are throttled by the UI adapter.
type progressWriter struct {
	Written int64
	Total   int64
	Report  func(float64)
}

func (w *progressWriter) Write(data []byte) (int, error) {
	w.Written += int64(len(data))
	if w.Report != nil && w.Total > 0 {
		w.Report(float64(w.Written) / float64(w.Total))
	}
	return len(data), nil
}

var _ io.Writer = (*progressWriter)(nil)

func showError(message string) {
	if os.Getenv("YINAMP_LAUNCHER_NO_UI") == "1" {
		return
	}
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.Command("/usr/bin/osascript", "-e", `on run argv
 display alert "Yinamp could not start" message (item 1 of argv) as critical
end run`, message)
	case "windows":
		command = exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", `Add-Type -AssemblyName System.Windows.Forms; [void][Windows.Forms.MessageBox]::Show($env:YINAMP_LAUNCH_ERROR,'Yinamp could not start')`)
		command.Env = append(os.Environ(), "YINAMP_LAUNCH_ERROR="+message)
	default:
		command = exec.Command("zenity", "--error", "--title=Yinamp could not start", "--text="+message)
	}
	_ = command.Run()
}

func progressStopReason(window *progressWindow) error {
	if window.Failure != nil {
		if err := window.Failure(); err != nil {
			return err
		}
	}
	return context.Canceled
}

func failedProgress(err error) *progressWindow {
	window := noProgress()
	stopped := make(chan struct{})
	close(stopped)
	window.Cancelled = stopped
	window.Failure = func() error { return fmt.Errorf("could not open setup window: %w", err) }
	return window
}
