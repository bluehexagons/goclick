package main

import (
	"context"
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
	fmt.Printf("Imported %d users and %d counter sets into %s.\n", result.Users, result.Counters, *target)
}
