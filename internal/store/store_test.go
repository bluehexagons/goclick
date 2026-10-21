package store

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
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

func TestOutOfOrderClicksKeepLatestPeriod(t *testing.T) {
	db := openTestStore(t)
	user := createTestUser(t, db, "late-click")
	ctx := context.Background()
	before := time.Date(2026, 12, 31, 23, 59, 59, 0, time.UTC)
	after := before.Add(time.Second)
	for _, when := range []time.Time{before, after, before, after.Add(-time.Hour)} {
		if _, err := db.Increment(ctx, user.ID, when); err != nil {
			t.Fatal(err)
		}
	}
	counters, err := db.CurrentCounters(ctx, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	assertCounters(t, counters, 4, 2, 2, 2)
	if counters.LastClickedAt == nil || !counters.LastClickedAt.Equal(after) {
		t.Fatalf("last click moved backward: %v", counters.LastClickedAt)
	}
	counters, err = db.Increment(ctx, user.ID, after.AddDate(0, 0, 1))
	if err != nil {
		t.Fatal(err)
	}
	assertCounters(t, counters, 5, 3, 2, 2)
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

func TestOpenRestrictsDatabasePermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "permissions.db")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}

	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if permissions := info.Mode().Perm(); permissions != 0o600 {
		t.Fatalf("database permissions = %o, want 600", permissions)
	}
}

func TestOpenRejectsForeignDatabaseWithoutModifyingSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "rails.sqlite3")
	foreign, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := foreign.Exec(`
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
			created_time datetime,
			modified_time datetime,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL
		);`); err != nil {
		foreign.Close()
		t.Fatal(err)
	}
	if err := foreign.Close(); err != nil {
		t.Fatal(err)
	}

	database, err := Open(path)
	if err == nil {
		database.Close()
		t.Fatal("Open accepted a foreign database")
	}
	if !strings.Contains(err.Error(), "not a compatible Go Click database") {
		t.Fatalf("Open error = %v", err)
	}
	if !strings.Contains(err.Error(), "missing users.password_hash") {
		t.Fatalf("Open error does not identify Rails users schema: %v", err)
	}

	foreign, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer foreign.Close()
	rows, err := foreign.Query(`
		SELECT name FROM sqlite_schema
		WHERE type = 'table' AND name NOT GLOB 'sqlite_*'
		ORDER BY name`)
	if err != nil {
		t.Fatal(err)
	}
	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		tables = append(tables, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	if strings.Join(tables, ",") != "entities,users" {
		t.Fatalf("tables after rejected Open = %v, want only original tables", tables)
	}
	var version int
	if err := foreign.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 0 {
		t.Fatalf("schema version after rejected Open = %d, want 0", version)
	}
	var journalMode string
	if err := foreign.QueryRow(`PRAGMA journal_mode`).Scan(&journalMode); err != nil {
		t.Fatal(err)
	}
	if journalMode == "wal" {
		t.Fatal("rejected Open changed the foreign database to WAL mode")
	}
}

func TestOpenUpgradesLegacyUnversionedDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	initial, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := initial.Close(); err != nil {
		t.Fatal(err)
	}

	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(`
		DROP TABLE rails_entities;
		PRAGMA user_version = 0;`); err != nil {
		legacy.Close()
		t.Fatal(err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}

	upgraded, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	var version int
	if err := upgraded.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != schemaVersion {
		t.Fatalf("schema version = %d, want %d", version, schemaVersion)
	}
	var archiveTable string
	if err := upgraded.db.QueryRow(`
		SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'rails_entities'`).Scan(&archiveTable); err != nil {
		t.Fatal(err)
	}
}

func TestInMemoryStoresAreIsolated(t *testing.T) {
	first, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()

	createTestUser(t, first, "first_store_user")
	if _, err := second.UserByIdentifier(context.Background(), "first_store_user"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("user lookup in independent store error = %v, want ErrNotFound", err)
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
