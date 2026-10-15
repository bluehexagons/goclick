package store

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestSessionActivityRenewsWithoutWritingEveryClick(t *testing.T) {
	db := openTestStore(t)
	user := createTestUser(t, db, "rolling_session")
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	lifetime := 180 * 24 * time.Hour
	token := []byte("rolling test session")
	if err := db.CreateSession(ctx, token, user.ID, now.Add(lifetime), now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.db.Exec(`CREATE TRIGGER reject_session_write BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT,'unnecessary authentication write'); END`); err != nil {
		t.Fatal(err)
	}
	session, err := db.UseSession(ctx, token, now.Add(time.Hour), lifetime)
	if err != nil || session.Renewed || !session.ExpiresAt.Equal(now.Add(lifetime)) {
		t.Fatalf("fresh session should only be read: %+v, %v", session, err)
	}
	if _, err := db.db.Exec(`DROP TRIGGER reject_session_write`); err != nil {
		t.Fatal(err)
	}
	for day := 60; day <= 480; day += 60 {
		activeAt := now.Add(time.Duration(day) * 24 * time.Hour)
		session, err = db.UseSession(ctx, token, activeAt, lifetime)
		if err != nil || !session.Renewed || session.User.ID != user.ID || !session.ExpiresAt.Equal(activeAt.Add(lifetime)) {
			t.Fatalf("activity after %d days: %+v, %v", day, session, err)
		}
		if err := db.DeleteExpiredSessions(ctx, activeAt); err != nil {
			t.Fatal(err)
		}
	}
	var createdAt int64
	if err := db.db.QueryRow(`SELECT created_at FROM sessions`).Scan(&createdAt); err != nil || createdAt != now.Unix() {
		t.Fatal("renewal changed original sign-in time", err)
	}
	_, total, err := db.Activity(ctx, user.ID, 25, 0)
	if err != nil || total != 2 {
		t.Fatalf("renewals created fake sign-in events: total=%d, %v", total, err)
	}
	if _, err := db.UseSession(ctx, token, session.ExpiresAt, lifetime); !errors.Is(err, ErrNotFound) {
		t.Fatalf("inactive session revived: %v", err)
	}
	if _, err := db.UseSession(ctx, []byte("unknown token"), now, lifetime); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown session created: %v", err)
	}
}

func TestRenewalPersistsAndNeverRevivesRevokedSessions(t *testing.T) {
	db := openTestStore(t)
	user := createTestUser(t, db, "session_restart")
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	token := []byte("persistent rolling session")
	lifetime := 180 * 24 * time.Hour
	if err := db.CreateSession(ctx, token, user.ID, now.Add(time.Hour), now.Add(-7*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if session, err := db.UseSession(ctx, token, now, lifetime); err != nil || !session.Renewed {
		t.Fatalf("legacy short session not extended: %+v, %v", session, err)
	}
	path := dbPath(t, db)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if session, err := db.UseSession(ctx, token, now.Add(12*time.Hour), lifetime); err != nil || session.User.ID != user.ID {
		t.Fatalf("renewal lost on restart: %+v, %v", session, err)
	}
	var requests sync.WaitGroup
	for i := range 16 {
		requests.Go(func() {
			_, err := db.UseSession(ctx, token, now.Add(48*time.Hour+time.Duration(i)*time.Second), lifetime)
			if err != nil && !errors.Is(err, ErrNotFound) {
				t.Errorf("concurrent renewal: %v", err)
			}
		})
	}
	if err := db.DeleteSession(ctx, token); err != nil {
		t.Fatal(err)
	}
	requests.Wait()
	if _, err := db.UseSession(ctx, token, now.Add(49*time.Hour), lifetime); !errors.Is(err, ErrNotFound) {
		t.Fatalf("renewal resurrected a revoked session: %v", err)
	}
}

func TestConcurrentRenewalsDoNotInvalidateOrShortenSessions(t *testing.T) {
	db := openTestStore(t)
	user := createTestUser(t, db, "parallel_session")
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	token := []byte("parallel session token")
	lifetime := 180 * 24 * time.Hour
	if err := db.CreateSession(ctx, token, user.ID, now.Add(time.Hour), now); err != nil {
		t.Fatal(err)
	}
	var requests sync.WaitGroup
	for i := range 16 {
		requests.Go(func() {
			session, err := db.UseSession(ctx, token, now.Add(time.Duration(i)*time.Second), lifetime)
			if err != nil || session.User.ID != user.ID || session.ExpiresAt.Before(now.Add(lifetime)) {
				t.Errorf("parallel request rejected or shortened expiry: %+v, %v", session, err)
			}
		})
	}
	requests.Wait()
}

func TestSessionReplacementRejectsChangedCredentials(t *testing.T) {
	for _, change := range []string{"password", "role", "deleted account"} {
		t.Run(change, func(t *testing.T) {
			db := openTestStore(t)
			verified := createTestUser(t, db, "signing_in")
			other := createTestUser(t, db, "previous_account")
			ctx := context.Background()
			now := time.Now().UTC()
			previous, next := []byte("previous session"), []byte("late sign-in")
			if err := db.CreateSession(ctx, previous, other.ID, now.Add(time.Hour), now); err != nil {
				t.Fatal(err)
			}
			switch change {
			case "password":
				if err := db.SetPassword(ctx, verified.ID, "replacement-password", now); err != nil {
					t.Fatal(err)
				}
			case "role":
				if err := db.SetAdmin(ctx, verified.ID, true, now); err != nil {
					t.Fatal(err)
				}
			case "deleted account":
				if _, err := db.db.ExecContext(ctx, `DELETE FROM users WHERE id=?`, verified.ID); err != nil {
					t.Fatal(err)
				}
			}
			_, before, err := db.Activity(ctx, 0, 25, 0)
			if err != nil {
				t.Fatal(err)
			}
			if err := db.ReplaceSession(ctx, next, previous, verified, now.Add(time.Hour), now); !errors.Is(err, ErrCredentialsChanged) {
				t.Fatalf("stale sign-in accepted: %v", err)
			}
			if _, err := db.UserBySession(ctx, next, now); !errors.Is(err, ErrNotFound) {
				t.Fatalf("late session exists: %v", err)
			}
			if _, err := db.UserBySession(ctx, previous, now); err != nil {
				t.Fatalf("failed sign-in revoked another account's session: %v", err)
			}
			_, after, err := db.Activity(ctx, 0, 25, 0)
			if err != nil || before != after {
				t.Fatalf("failed sign-in recorded activity: %d -> %d, %v", before, after, err)
			}
			if change != "deleted account" {
				fresh, err := db.UserByID(ctx, verified.ID)
				if err != nil {
					t.Fatal(err)
				}
				if err := db.ReplaceSession(ctx, next, previous, fresh, now.Add(time.Hour), now); err != nil {
					t.Fatalf("fresh sign-in rejected: %v", err)
				}
			}
		})
	}
}
