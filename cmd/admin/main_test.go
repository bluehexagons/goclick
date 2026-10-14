package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bluehexagons/goclick/internal/store"
)

func TestBootstrapAdminCommand(t *testing.T) {
	path := filepath.Join(t.TempDir(), "goclick.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	user, err := db.CreateUser(context.Background(), "first_admin", nil, "test hash", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	var out, errOut bytes.Buffer
	if status := run([]string{"-database", path, "-username", user.Username}, &out, &errOut); status != 0 {
		t.Fatalf("command status=%d error=%s", status, errOut.String())
	}
	db, err = store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	user, err = db.UserByID(context.Background(), user.ID)
	if err != nil || !user.Admin {
		t.Fatalf("admin user: %+v %v", user, err)
	}
	if status := run([]string{"-database", path, "-user-id", "1", "-revoke"}, &out, &errOut); status == 0 {
		t.Fatal("command revoked last admin")
	}
	if !strings.Contains(out.String(), "/admin") {
		t.Fatal("command omitted access instructions")
	}
}

func TestBootstrapRejectsMissingDatabaseAndAmbiguousSelector(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing.db")
	var out bytes.Buffer
	if run([]string{"-database", path, "-username", "missing"}, &out, &out) == 0 {
		t.Fatal("accepted missing database")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("created an unintended database")
	}
	if run([]string{"-user-id", "1", "-username", "player"}, &out, &out) != 2 {
		t.Fatal("accepted ambiguous selectors")
	}
}
