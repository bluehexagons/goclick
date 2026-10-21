package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestRegistrationCannotCreateAnOverlappingLegacyIdentifier(t *testing.T) {
	for _, kind := range []string{"email", "username"} {
		t.Run(kind, func(t *testing.T) {
			legacyUsername, legacyEmail := "shared@example.com", "legacy@example.com"
			username := "new_player"
			email := "shared@example.com"
			if kind == "username" {
				legacyUsername, legacyEmail = "legacy_account", "legacy_name"
				username, email = "legacy_name", "new@example.com"
			}
			ctx := context.Background()
			target := openTestStore(t)
			if _, err := target.CreateUser(ctx, legacyUsername, &legacyEmail, "existing-password-hash", time.Now()); err != nil {
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
