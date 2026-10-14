package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/bluehexagons/goclick/internal/store"
)

func main() { os.Exit(runWithInput(os.Args[1:], os.Stdin, os.Stdout, os.Stderr)) }

func run(args []string, out, errOut io.Writer) int {
	return runWithInput(args, strings.NewReader(""), out, errOut)
}

func runWithInput(args []string, input io.Reader, out, errOut io.Writer) int {
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
	passwordStdin := flags.Bool("password-stdin", false, "set a new password from one line on stdin; does not change admin role")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() != 0 || (*id <= 0 && *username == "") || (*id != 0 && *username != "") || *id < 0 {
		fmt.Fprintln(errOut, "Specify exactly one of -user-id or -username. Create the account through signup first.")
		return 2
	}
	if *passwordStdin && *revoke {
		fmt.Fprintln(errOut, "Password setup and role changes must be separate commands.")
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
	if *passwordStdin {
		scanner := bufio.NewScanner(input)
		scanner.Buffer(make([]byte, 128), 1024)
		if !scanner.Scan() {
			fmt.Fprintln(errOut, "Read a password from stdin (8–72 bytes).")
			return 2
		}
		password := scanner.Text()
		if scanner.Scan() || scanner.Err() != nil {
			fmt.Fprintln(errOut, "Provide exactly one password line.")
			return 2
		}
		if err := database.SetPassword(ctx, *id, password, time.Now()); err != nil {
			fmt.Fprintln(errOut, "Set password:", err)
			return 1
		}
		fmt.Fprintf(out, "Password set for user %d. Existing sessions revoked; admin role unchanged.\n", *id)
		return 0
	}
	if err := database.SetAdmin(ctx, *id, !*revoke, time.Now()); err != nil {
		fmt.Fprintln(errOut, "Update admin access:", err)
		return 1
	}
	fmt.Fprintf(out, "Admin access for user %d is now %t. Sign in again, then open /admin.\n", *id, !*revoke)
	return 0
}
