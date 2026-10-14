package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/bluehexagons/goclick/internal/store"
)

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, out, errOut io.Writer) int {
	flags := flag.NewFlagSet("admin", flag.ContinueOnError)
	flags.SetOutput(errOut)
	defaultPath := os.Getenv("GOCLICK_DATABASE")
	if defaultPath == "" {
		defaultPath = "data/goclick.db"
	}
	path := flags.String("database", defaultPath, "existing Go Click SQLite database")
	id := flags.Int64("user-id", 0, "existing user ID")
	username := flags.String("username", "", "existing username (exact match)")
	revoke := flags.Bool("revoke", false, "revoke access instead of granting it")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() != 0 || (*id <= 0 && *username == "") || (*id != 0 && *username != "") || *id < 0 {
		fmt.Fprintln(errOut, "Specify exactly one of -user-id or -username. Create the account through signup first.")
		return 2
	}
	info, err := os.Stat(*path)
	if err != nil || !info.Mode().IsRegular() {
		fmt.Fprintln(errOut, "Database must be an existing regular file; refusing to create a new database.")
		return 1
	}
	database, err := store.Open(*path)
	if err != nil {
		fmt.Fprintln(errOut, "Open database:", err)
		return 1
	}
	defer database.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if *username != "" {
		user, err := database.UserByUsername(ctx, *username)
		if err != nil || user.Username != *username {
			fmt.Fprintln(errOut, "No account with that exact username.")
			return 1
		}
		*id = user.ID
	}
	if err := database.SetAdmin(ctx, *id, !*revoke, time.Now()); err != nil {
		fmt.Fprintln(errOut, "Update admin access:", err)
		return 1
	}
	fmt.Fprintf(out, "Admin access for user %d is now %t. Sign in again, then open /admin.\n", *id, !*revoke)
	return 0
}
