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
	"golang.org/x/crypto/bcrypt"
)

func TestOperatorPasswordCommandDoesNotGrantAccessOrExposeSecrets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	u, err := db.CreateUser(context.Background(), "imported_player", nil, "locked hash", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	args := []string{"-database", path, "-username", u.Username, "-password-stdin"}
	var out, errOut bytes.Buffer
	password := "new-long-password"
	if status := runWithInput(args, strings.NewReader(password+"\n"), &out, &errOut); status != 0 {
		t.Fatalf("password command %d: %s", status, errOut.String())
	}
	if strings.Contains(out.String()+errOut.String(), password) {
		t.Fatal("command printed the password")
	}
	db, err = store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	u, err = db.UserByID(context.Background(), u.ID)
	if err != nil || u.Admin || bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil {
		t.Fatal("password command changed role or failed")
	}
	if status := runWithInput(args, strings.NewReader("new-password\nsecond-password\n"), &out, &errOut); status != 2 {
		t.Fatal("accepted multiple password lines")
	}
	if status := runWithInput(append(args, "-revoke"), strings.NewReader(password), &out, &errOut); status != 2 {
		t.Fatal("accepted combined role/password mutation")
	}
}

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
