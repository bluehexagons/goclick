package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

func TestIncrementUpdatesStreaks(t *testing.T) {
	database := openTestStore(t)
	user := createTestUser(t, database, "streaker")
	ctx := context.Background()

	first := time.Date(2026, time.January, 10, 8, 0, 0, 0, time.UTC)
	counters, err := database.Increment(ctx, user.ID, first)
	if err != nil {
		t.Fatal(err)
	}
	assertCounters(t, counters, 1, 1, 1, 1)

	counters, err = database.Increment(ctx, user.ID, first.Add(3*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	assertCounters(t, counters, 2, 1, 1, 1)

	counters, err = database.Increment(ctx, user.ID, first.AddDate(0, 0, 1))
	if err != nil {
		t.Fatal(err)
	}
	assertCounters(t, counters, 3, 2, 1, 1)

	counters, err = database.Increment(ctx, user.ID, time.Date(2026, time.March, 1, 8, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	assertCounters(t, counters, 4, 1, 1, 1)

	counters, err = database.Increment(ctx, user.ID, time.Date(2027, time.January, 1, 8, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	assertCounters(t, counters, 5, 1, 1, 2)
}

func TestMonthlyStreakUsesMonthBoundary(t *testing.T) {
	database := openTestStore(t)
	user := createTestUser(t, database, "month-edge")
	ctx := context.Background()

	counters, err := database.Increment(ctx, user.ID, time.Date(2026, time.February, 28, 20, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	assertCounters(t, counters, 1, 1, 1, 1)

	// Subtracting a month directly from March 31 normalizes back into March.
	// The streak calculation must instead subtract from March's first day.
	counters, err = database.Increment(ctx, user.ID, time.Date(2026, time.March, 31, 20, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	assertCounters(t, counters, 2, 1, 2, 1)

	counters, err = database.Increment(ctx, user.ID, time.Date(2026, time.March, 31, 21, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	assertCounters(t, counters, 3, 1, 2, 1)

	counters, err = database.Increment(ctx, user.ID, time.Date(2026, time.April, 30, 20, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	assertCounters(t, counters, 4, 1, 3, 1)
}

func TestSessionStoresDigestAndExpires(t *testing.T) {
	database := openTestStore(t)
	user := createTestUser(t, database, "session-user")
	ctx := context.Background()
	now := time.Date(2026, time.July, 26, 12, 0, 0, 0, time.UTC)
	raw := []byte("a sufficiently random token for test")

	if err := database.CreateSession(ctx, raw, user.ID, now.Add(time.Hour), now); err != nil {
		t.Fatal(err)
	}
	if _, err := database.UserBySession(ctx, raw, now); err != nil {
		t.Fatalf("active session rejected: %v", err)
	}
	if _, err := database.UserBySession(ctx, raw, now.Add(2*time.Hour)); err != ErrNotFound {
		t.Fatalf("expired session error = %v, want ErrNotFound", err)
	}

	var stored []byte
	if err := database.db.QueryRow(`SELECT token_hash FROM sessions`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if string(stored) == string(raw) {
		t.Fatal("raw session token was stored")
	}
	if err := database.DeleteExpiredSessions(ctx, now.Add(2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	var remaining int
	if err := database.db.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("expired session rows = %d, want 0", remaining)
	}
}

func TestImportRailsPreservesPasswordsAndCounters(t *testing.T) {
	sourcePath := filepath.Join(t.TempDir(), "production.sqlite3")
	source, err := sql.Open("sqlite", sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = source.Exec(`
		CREATE TABLE users (
			id INTEGER PRIMARY KEY,
			username TEXT NOT NULL,
			email TEXT,
			password_digest TEXT,
			admin INTEGER NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL
		);
		CREATE TABLE entities (
			id INTEGER PRIMARY KEY,
			user_id INTEGER NOT NULL,
			kind TEXT,
			count INTEGER,
			modified_time datetime,
			updated_at datetime NOT NULL
		);`)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("old-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	created := "2025-12-12 18:00:00"
	if _, err := source.Exec(`
		INSERT INTO users VALUES (42, 'legacy_user', 'legacy@example.com', ?, 1, ?, ?);
		INSERT INTO entities (user_id, kind, count, modified_time, updated_at) VALUES
			(42, 'click_count', 1234, '2026-07-25 15:30:00', '2026-07-25 15:30:00'),
			(42, 'streak_counter_day', 8, '2026-07-25 15:30:00', '2026-07-25 15:30:00'),
			(42, 'streak_counter_month', 4, '2026-07-25 15:30:00', '2026-07-25 15:30:00'),
			(42, 'streak_counter_year', 2, '2026-07-25 15:30:00', '2026-07-25 15:30:00')`,
		string(hash), created, created); err != nil {
		t.Fatal(err)
	}
	if err := source.Close(); err != nil {
		t.Fatal(err)
	}

	target := openTestStore(t)
	result, err := target.ImportRails(context.Background(), sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	if result.Users != 1 || result.Counters != 1 {
		t.Fatalf("result = %+v", result)
	}
	user, err := target.UserByIdentifier(context.Background(), "legacy_user")
	if err != nil {
		t.Fatal(err)
	}
	if user.ID != 42 || !user.Admin {
		t.Fatalf("imported user = %+v", user)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte("old-password")); err != nil {
		t.Fatalf("migrated password does not work: %v", err)
	}
	counters, err := target.CurrentCounters(context.Background(), user.ID)
	if err != nil {
		t.Fatal(err)
	}
	assertCounters(t, counters, 1234, 8, 4, 2)

	// The importer is intentionally safe to rerun during cutover rehearsals.
	if _, err := target.ImportRails(context.Background(), sourcePath); err != nil {
		t.Fatalf("second import failed: %v", err)
	}
}

func openTestStore(t *testing.T) *Store {
	t.Helper()
	database, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func createTestUser(t *testing.T, database *Store, username string) User {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	user, err := database.CreateUser(context.Background(), username, nil, string(hash), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return user
}

func assertCounters(t *testing.T, counters Counters, clicks, day, month, year int64) {
	t.Helper()
	if counters.Clicks != clicks || counters.DayStreak != day ||
		counters.MonthStreak != month || counters.YearStreak != year {
		t.Fatalf("counters = %+v, want clicks=%d day=%d month=%d year=%d",
			counters, clicks, day, month, year)
	}
}
