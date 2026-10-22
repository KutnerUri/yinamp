package main

import (
	"archive/zip"
	"io"
	"os"
	"path/filepath"
	"time"
)

func packRuntime(root, destination string) error {
	file, err := os.Create(destination)
	if err != nil {
		return err
	}
	defer file.Close()
	archive := zip.NewWriter(file)
	err = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if path == root {
			return nil
		}
		relative, e := filepath.Rel(root, path)
		if e != nil {
			return e
		}
		header, e := zip.FileInfoHeader(info)
		if e != nil {
			return e
		}
		header.Name = filepath.ToSlash(relative)
		header.Modified = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
		header.Method = zip.Deflate
		if info.IsDir() {
			header.Name += "/"
		}
		writer, e := archive.CreateHeader(header)
		if e != nil {
			return e
		}
		if info.Mode()&os.ModeSymlink != 0 {
			target, e := os.Readlink(path)
			if e != nil {
				return e
			}
			_, e = io.WriteString(writer, target)
			return e
		}
		if info.IsDir() {
			return nil
		}
		input, e := os.Open(path)
		if e != nil {
			return e
		}
		defer input.Close()
		_, e = io.Copy(writer, input)
		return e
	})
	if err != nil {
		archive.Close()
		return err
	}
	return archive.Close()
}
