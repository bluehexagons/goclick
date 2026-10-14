package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestConnectionSettingsSurviveReplacement(t *testing.T) {
	database := openTestStore(t)
	user := createTestUser(t, database, "reconnected")
	ctx := context.Background()
	conn, err := database.db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.Raw(func(any) error { return driver.ErrBadConn }); !errors.Is(err, driver.ErrBadConn) {
		t.Fatalf("discard connection: %v", err)
	}
	conn.Close()

	for pragma, want := range map[string]int{"foreign_keys": 1, "busy_timeout": 5000} {
		var got int
		if err := database.db.QueryRow("PRAGMA " + pragma).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Fatalf("%s after reconnect = %d, want %d", pragma, got, want)
		}
	}
	if _, err := database.UserByID(ctx, user.ID); err != nil {
		t.Fatalf("persisted user lost on reconnect: %v", err)
	}
	if err := database.CreateSession(ctx, []byte("orphan"), user.ID+1, time.Now().Add(time.Hour), time.Now()); err == nil {
		t.Fatal("replacement connection allowed an orphan session")
	}
}

func TestOpenUsesLiteralFilenameAndPreservesDirectoryMode(t *testing.T) {
	directory := t.TempDir()
	if err := os.Chmod(directory, 0o750); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(directory, "literal?mode=memory#database.sqlite3")
	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	user := createTestUser(t, database, "literal_path")
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(directory)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o750 {
		t.Fatalf("changed shared directory mode to %o", info.Mode().Perm())
	}
	info, err = os.Stat(path)
	if err != nil || info.Size() == 0 {
		t.Fatalf("literal database file not populated: %v", err)
	}
	database, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if _, err := database.UserByID(context.Background(), user.ID); err != nil {
		t.Fatalf("literal database did not persist user: %v", err)
	}
}

func TestFailedSchemaUpgradeRollsBack(t *testing.T) {
	path := filepath.Join(t.TempDir(), "upgrade.db")
	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	user := createTestUser(t, database, "preserved")
	if _, err := database.db.Exec(`
		DROP TABLE rails_entities;
		CREATE TABLE rails_entities (id INTEGER PRIMARY KEY, user_id INTEGER);
		DROP INDEX sessions_user_id;
		PRAGMA user_version = 1;`); err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	if database, err := Open(path); err == nil {
		database.Close()
		t.Fatal("accepted malformed archive")
	} else if !strings.Contains(err.Error(), "missing rails_entities.kind") {
		t.Fatalf("unexpected schema error: %v", err)
	}
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var version, newIndexes, users int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := raw.QueryRow(`SELECT COUNT(*) FROM sqlite_schema WHERE name IN ('rails_entities_user_id', 'sessions_user_id')`).Scan(&newIndexes); err != nil {
		t.Fatal(err)
	}
	if err := raw.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, user.ID).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if version != 1 || newIndexes != 0 || users != 1 {
		t.Fatalf("failed upgrade changed database: version=%d new indexes=%d users=%d", version, newIndexes, users)
	}
}

func TestReplaceSessionIsAtomic(t *testing.T) {
	database := openTestStore(t)
	user := createTestUser(t, database, "rotating")
	ctx := context.Background()
	now := time.Now()
	oldToken, newToken := []byte("previous token"), []byte("replacement token")
	if err := database.CreateSession(ctx, oldToken, user.ID, now.Add(time.Hour), now); err != nil {
		t.Fatal(err)
	}
	// A foreign-key failure must preserve the existing session.
	if err := database.ReplaceSession(ctx, newToken, oldToken, user.ID+1, now.Add(time.Hour), now); err == nil {
		t.Fatal("replacement accepted a nonexistent user")
	}
	if _, err := database.UserBySession(ctx, oldToken, now); err != nil {
		t.Fatalf("failed replacement revoked previous session: %v", err)
	}
	if err := database.ReplaceSession(ctx, newToken, oldToken, user.ID, now.Add(time.Hour), now); err != nil {
		t.Fatal(err)
	}
	if _, err := database.UserBySession(ctx, oldToken, now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("previous session still active: %v", err)
	}
	if _, err := database.UserBySession(ctx, newToken, now); err != nil {
		t.Fatalf("replacement session unavailable: %v", err)
	}
}

func TestStreaksUseUTCThroughDaylightSavingTransitions(t *testing.T) {
	location, err := time.LoadLocation("America/Chicago")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name        string
		first, next time.Time
		wantDay     int64
	}{
		{"spring same UTC day", time.Date(2026, 3, 8, 12, 0, 0, 0, time.UTC), time.Date(2026, 3, 8, 18, 30, 0, 0, location), 1},
		{"fall next UTC day", time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC), time.Date(2026, 11, 1, 18, 30, 0, 0, location), 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			database := openTestStore(t)
			user := createTestUser(t, database, "utc_streak")
			if _, err := database.Increment(context.Background(), user.ID, test.first); err != nil {
				t.Fatal(err)
			}
			counters, err := database.Increment(context.Background(), user.ID, test.next)
			if err != nil {
				t.Fatal(err)
			}
			assertCounters(t, counters, 2, test.wantDay, 1, 1)
		})
	}
}

func TestCreateUserReportsDuplicateAsConflict(t *testing.T) {
	database := openTestStore(t)
	user := createTestUser(t, database, "duplicate")
	if _, err := database.CreateUser(context.Background(), user.Username, nil, user.PasswordHash, time.Now()); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate username error = %v, want ErrConflict", err)
	}
}
