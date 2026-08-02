package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/bluehexagons/goclick/internal/store"
)

func main() {
	source := flag.String("source", "", "path to the Minimal Clicker Rails SQLite database")
	target := flag.String("target", "data/goclick.db", "path to the Go Click SQLite database")
	flag.Parse()

	if *source == "" {
		fmt.Fprintln(os.Stderr, "error: -source is required")
		flag.Usage()
		os.Exit(2)
	}
	sourcePath, sourceErr := filepath.Abs(*source)
	targetPath, targetErr := filepath.Abs(*target)
	if sourceErr != nil || targetErr != nil {
		fmt.Fprintln(os.Stderr, "error: could not resolve database paths")
		os.Exit(1)
	}
	if sourcePath == targetPath {
		fmt.Fprintln(os.Stderr, "error: source and target databases must be different files")
		os.Exit(2)
	}
	sameFile, err := sameDatabaseFile(sourcePath, targetPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: inspect database paths: %v\n", err)
		os.Exit(1)
	}
	if sameFile {
		fmt.Fprintln(os.Stderr, "error: source and target databases must be different files")
		os.Exit(2)
	}

	database, err := store.Open(*target)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: open target database: %v\n", err)
		os.Exit(1)
	}
	defer database.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	result, err := database.ImportRails(ctx, *source)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: import failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Imported %d users, %d entities, and %d counter sets into %s.\n", result.Users, result.Entities, result.Counters, *target)
}

func sameDatabaseFile(sourcePath, targetPath string) (bool, error) {
	sourceInfo, err := os.Stat(sourcePath)
	if err != nil {
		return false, fmt.Errorf("source database: %w", err)
	}
	if !sourceInfo.Mode().IsRegular() {
		return false, errors.New("source database is not a regular file")
	}

	targetInfo, err := os.Stat(targetPath)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("target database: %w", err)
	}
	if !targetInfo.Mode().IsRegular() {
		return false, errors.New("target database is not a regular file")
	}
	return os.SameFile(sourceInfo, targetInfo), nil
}
