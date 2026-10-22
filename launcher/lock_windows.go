package main

import (
	"os"
	"syscall"
	"unsafe"
)

var lockFileEx = syscall.NewLazyDLL("kernel32.dll").NewProc("LockFileEx")
var unlockFileEx = syscall.NewLazyDLL("kernel32.dll").NewProc("UnlockFileEx")

func lockRuntime(path string) (func(), error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	overlapped := new(syscall.Overlapped)
	result, _, err := lockFileEx.Call(file.Fd(), 2, 0, 1, 0, uintptr(unsafe.Pointer(overlapped)))
	if result == 0 {
		file.Close()
		return nil, err
	}
	return func() { unlockFileEx.Call(file.Fd(), 0, 1, 0, uintptr(unsafe.Pointer(overlapped))); file.Close() }, nil
}
