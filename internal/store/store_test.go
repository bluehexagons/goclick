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
		WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
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
			created_time datetime,
			modified_time datetime,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL
		);`)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("old-password"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	created := "2025-12-12 18:00:00"
	if _, err := source.Exec(`
		INSERT INTO users VALUES (42, 'legacy_user', 'legacy@example.com', ?, 1, ?, ?);
		INSERT INTO entities (id, user_id, kind, count, created_time, modified_time, created_at, updated_at) VALUES
			(101, 42, 'click_count', 1234, '2026-07-25 15:30:00', '2026-07-25 15:30:00', '2026-07-25 15:30:00', '2026-07-25 15:30:00'),
			(102, 42, 'streak_counter_day', 8, '2026-07-25 15:30:00', '2026-07-25 15:30:00', '2026-07-25 15:30:00', '2026-07-25 15:30:00'),
			(103, 42, 'streak_counter_month', 4, '2026-07-25 15:30:00', '2026-07-25 15:30:00', '2026-07-25 15:30:00', '2026-07-25 15:30:00'),
			(104, 42, 'streak_counter_year', 2, '2026-07-25 15:30:00', '2026-07-25 15:30:00', '2026-07-25 15:30:00', '2026-07-25 15:30:00'),
			(105, 42, 'custom_kind', NULL, NULL, NULL, '2026-07-25 15:30:00', '2026-07-25 15:30:00'),
			(106, 42, NULL, -7, NULL, NULL, '2026-07-25 15:30:00', '2026-07-25 15:30:00')`,
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
	if result.Users != 1 || result.Counters != 1 || result.Entities != 6 {
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
	var archived int
	if err := target.db.QueryRow(`SELECT COUNT(*) FROM rails_entities`).Scan(&archived); err != nil {
		t.Fatal(err)
	}
	if archived != 6 {
		t.Fatalf("archived entities = %d, want 6", archived)
	}
	var customKind sql.NullString
	var customCount sql.NullInt64
	if err := target.db.QueryRow(`SELECT kind, count FROM rails_entities WHERE id = 105`).Scan(&customKind, &customCount); err != nil {
		t.Fatal(err)
	}
	if !customKind.Valid || customKind.String != "custom_kind" || customCount.Valid {
		t.Fatalf("archived custom entity = kind %v count %v", customKind, customCount)
	}
	var nullKind sql.NullString
	var nullCount int64
	if err := target.db.QueryRow(`SELECT kind, count FROM rails_entities WHERE id = 106`).Scan(&nullKind, &nullCount); err != nil {
		t.Fatal(err)
	}
	if nullKind.Valid || nullCount != -7 {
		t.Fatalf("archived nullable entity = kind %v count %d", nullKind, nullCount)
	}

	// The importer is intentionally safe to rerun during cutover rehearsals.
	if _, err := target.ImportRails(context.Background(), sourcePath); err != nil {
		t.Fatalf("second import failed: %v", err)
	}
	if _, err := target.db.Exec(`UPDATE counters SET click_count = 999 WHERE user_id = 42`); err != nil {
		t.Fatal(err)
	}
	if _, err := target.ImportRails(context.Background(), sourcePath); err == nil || !strings.Contains(err.Error(), "target counters for user 42 differ") {
		t.Fatalf("conflicting rerun error = %v", err)
	}

	source, err = sql.Open("sqlite", sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.Exec(`UPDATE entities SET count = -1 WHERE id = 101`); err != nil {
		source.Close()
		t.Fatal(err)
	}
	if err := source.Close(); err != nil {
		t.Fatal(err)
	}
	negativeTarget := openTestStore(t)
	if _, err := negativeTarget.ImportRails(context.Background(), sourcePath); err == nil || !strings.Contains(err.Error(), "negative count") {
		t.Fatalf("negative canonical count error = %v", err)
	}
	var users int
	if err := negativeTarget.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if users != 0 {
		t.Fatalf("users after failed import = %d, want 0", users)
	}
}

func TestImportRailsRejectsUnsafePasswordDigest(t *testing.T) {
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
			created_time datetime,
			modified_time datetime,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL
		);`)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("old-password"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	unsafeHash := strings.Replace(string(hash), "$10$", "$31$", 1)
	if _, err := source.Exec(`
		INSERT INTO users VALUES
			(1, 'poisoned_user', NULL, ?, 0, '2026-01-01 00:00:00', '2026-01-01 00:00:00')`,
		unsafeHash); err != nil {
		t.Fatal(err)
	}
	if err := source.Close(); err != nil {
		t.Fatal(err)
	}

	target := openTestStore(t)
	_, err = target.ImportRails(context.Background(), sourcePath)
	if err == nil || !strings.Contains(err.Error(), "unsupported bcrypt cost 31") {
		t.Fatalf("unsafe password digest error = %v", err)
	}
}

func TestImportRailsRejectsNonRegularSource(t *testing.T) {
	target := openTestStore(t)
	_, err := target.ImportRails(context.Background(), t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "not a regular file") {
		t.Fatalf("directory source error = %v", err)
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
