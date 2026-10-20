package store

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"
)

func TestRegistrationCannotCreateAnOverlappingLegacyIdentifier(t *testing.T) {
	for _, kind := range []string{"email", "username"} {
		t.Run(kind, func(t *testing.T) {
			path, _ := railsRestoreFixture(t)
			source, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			legacyUsername, legacyEmail := "shared@example.com", "legacy@example.com"
			username := "new_player"
			email := "shared@example.com"
			if kind == "username" {
				legacyUsername, legacyEmail = "legacy_account", "legacy_name"
				username, email = "legacy_name", "new@example.com"
			}
			_, err = source.Exec(`UPDATE users SET username=?,email=?`, legacyUsername, legacyEmail)
			closeErr := source.Close()
			if err != nil {
				t.Fatal(err)
			}
			if closeErr != nil {
				t.Fatal(closeErr)
			}
			ctx := context.Background()
			target := openTestStore(t)
			if _, err := target.ImportRails(ctx, path); err != nil {
				t.Fatal(err)
			}
			if _, err := target.CreateUser(ctx, username, &email, "unused because registration is rejected", time.Now()); !errors.Is(err, ErrConflict) {
				t.Fatalf("overlapping registration error = %v", err)
			}
			var count int
			if err := target.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count); err != nil || count != 1 {
				t.Fatalf("rejected registration changed users: count=%d error=%v", count, err)
			}
			user, err := target.UserByIdentifier(ctx, legacyUsername)
			if err != nil || user.Username != legacyUsername || user.Email == nil || *user.Email != legacyEmail {
				t.Fatal("rejected registration changed the imported identity")
			}
		})
	}
}
