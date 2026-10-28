package main

import "fmt"

var diskAvailable = availableSpace

const spaceReserve = 64 * 1024 * 1024

func requireSpace(path string, bytes uint64) error {
	free, err := diskAvailable(path)
	if err != nil {
		return fmt.Errorf("could not check free disk space: %w", err)
	}
	needed := bytes + spaceReserve
	if free < needed {
		return fmt.Errorf("not enough disk space for Yinamp setup: need %d MB free, have %d MB; free some space and reopen Yinamp", (needed+999999)/1000000, free/1000000)
	}
	return nil
}
