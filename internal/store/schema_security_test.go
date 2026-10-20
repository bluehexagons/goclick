package store

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRestoreRejectsSchemaObjectNameCollisions(t *testing.T) {
	ctx := context.Background()
	live, actor := adminFixture(t)
	now := time.Now()
	if _, err := live.Increment(ctx, actor.ID, now); err != nil {
		t.Fatal(err)
	}
	path, err := live.Backup(ctx, t.TempDir(), "source")
	if err != nil {
		t.Fatal(err)
	}
	source, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	// SQLite allows a trigger and index to share a name. Create the harmless
	// trigger first so a map keyed only by name would hide it behind the index.
	_, err = source.Exec(`DROP INDEX rails_entities_user_id;
CREATE TRIGGER rails_entities_user_id AFTER UPDATE ON counters BEGIN SELECT 1; END;
CREATE INDEX rails_entities_user_id ON rails_entities(user_id)`)
	closeErr := source.Close()
	if err != nil {
		t.Fatal(err)
	}
	if closeErr != nil {
		t.Fatal(closeErr)
	}
	if _, err := live.Increment(ctx, actor.ID, now); err != nil {
		t.Fatal(err)
	}
	token := make([]byte, 32)
	if err := live.CreateSession(ctx, token, actor.ID, now.Add(time.Hour), now); err != nil {
		t.Fatal(err)
	}
	if _, err := live.Restore(ctx, path, t.TempDir(), actor, now); !errors.Is(err, ErrInvalidBackup) || !strings.Contains(err.Error(), "duplicate schema object name") {
		t.Fatalf("restore accepted a hidden schema object: %v", err)
	}
	counters, err := live.CurrentCounters(ctx, actor.ID)
	if err != nil || counters.Clicks != 2 {
		t.Fatalf("rejected restore changed live progress: counters=%+v error=%v", counters, err)
	}
	user, err := live.UserBySession(ctx, token, now)
	if err != nil || user.ID != actor.ID || user.PasswordHash != actor.PasswordHash || !user.Admin {
		t.Fatalf("rejected restore changed the active administrator session: user=%+v error=%v", user, err)
	}
}

func TestOpenRejectsSystemPrefixLookalikes(t *testing.T) {
	for _, name := range []string{"sqlitex_data", "SQLITEX_data"} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "foreign.db")
			source, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			_, err = source.Exec(`CREATE TABLE ` + name + `(value TEXT); INSERT INTO ` + name + ` VALUES ('preserve me')`)
			closeErr := source.Close()
			if err != nil {
				t.Fatal(err)
			}
			if closeErr != nil {
				t.Fatal(closeErr)
			}
			if database, err := Open(path); err == nil {
				database.Close()
				t.Fatal("Open initialized a foreign database with a system-prefix lookalike")
			}
			source, err = sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			defer source.Close()
			var tables, version int
			var journal, value string
			if err := source.QueryRow(`SELECT COUNT(*) FROM sqlite_schema WHERE type='table'`).Scan(&tables); err != nil {
				t.Fatal(err)
			}
			if err := source.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
				t.Fatal(err)
			}
			if err := source.QueryRow(`PRAGMA journal_mode`).Scan(&journal); err != nil {
				t.Fatal(err)
			}
			if err := source.QueryRow(`SELECT value FROM ` + name).Scan(&value); err != nil {
				t.Fatal(err)
			}
			if tables != 1 || version != 0 || journal != "delete" || value != "preserve me" {
				t.Fatalf("rejected Open changed foreign data: tables=%d version=%d journal=%s value=%q", tables, version, journal, value)
			}
		})
	}
}
