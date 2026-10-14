package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func railsRestoreFixture(t *testing.T) (string, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "rails.sqlite3")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	hash, err := bcrypt.GenerateFromPassword([]byte("old-password"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT, email TEXT, password_digest TEXT, admin INTEGER, created_at datetime, updated_at datetime, refresh_token_digest TEXT);
CREATE TABLE entities(id INTEGER PRIMARY KEY,user_id INTEGER,kind TEXT,count INTEGER,created_time datetime,modified_time datetime,created_at datetime,updated_at datetime);
CREATE TABLE schema_migrations(version TEXT PRIMARY KEY);
CREATE TRIGGER source_only AFTER INSERT ON entities BEGIN SELECT 1; END;
INSERT INTO entities VALUES
 (101,1,'click_count',987,'2024-01-01 10:00:00','2026-09-29 19:30:00','2024-01-01 10:00:00','2026-09-29 19:30:00'),
 (102,1,'streak_counter_day',12,NULL,NULL,'2024-01-01 10:00:00','2026-09-29 19:30:00'),
 (103,1,'streak_counter_month',7,NULL,NULL,'2024-01-01 10:00:00','2026-09-29 19:30:00'),
 (104,1,'streak_counter_year',3,NULL,NULL,'2024-01-01 10:00:00','2026-09-29 19:30:00'),
 (105,1,'custom_kind',NULL,NULL,NULL,'2024-01-01 10:00:00','2026-09-29 19:30:00'),
 (106,1,NULL,-7,NULL,NULL,'2024-01-01 10:00:00','2026-09-29 19:30:00');`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO users VALUES (1,'rails_admin','rails@example.com',?,1,'2024-01-01 10:00:00','2026-09-29 19:30:00','not-portable')`, string(hash)); err != nil {
		t.Fatal(err)
	}
	return path, string(hash)
}

func TestRestoreRailsSchemaZeroReplacesCollidingUserWithRecovery(t *testing.T) {
	db, actor := adminFixture(t)
	ctx, now := context.Background(), time.Now()
	if _, err := db.Increment(ctx, actor.ID, now); err != nil {
		t.Fatal(err)
	}
	if err := db.CreateSession(ctx, []byte("old session"), actor.ID, now.Add(time.Hour), now); err != nil {
		t.Fatal(err)
	}
	path, hash := railsRestoreFixture(t)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	recoveryDir := t.TempDir()
	result, err := db.Restore(ctx, path, recoveryDir, actor, now)
	if err != nil || result.SourceFormat != "rails_sqlite" || result.Users != 1 || result.Entities != 6 {
		t.Fatalf("Rails restore: %+v %v", result, err)
	}
	u, err := db.UserByID(ctx, 1)
	if err != nil || u.Username != "rails_admin" || u.PasswordHash != hash || !u.Admin || formatTime(u.CreatedAt) != "2024-01-01T10:00:00Z" || formatTime(u.UpdatedAt) != "2026-09-29T19:30:00Z" {
		t.Fatalf("migrated account: %+v %v", u, err)
	}
	c, err := db.CurrentCounters(ctx, 1)
	if err != nil || c.Clicks != 987 || c.DayStreak != 12 || c.MonthStreak != 7 || c.YearStreak != 3 {
		t.Fatalf("progress: %+v %v", c, err)
	}
	entities, total, err := db.ArchivedEntities(ctx, 1, 25, 0)
	if err != nil || total != 6 || entities[4].Kind == nil || *entities[4].Kind != "custom_kind" || entities[4].Count != nil || entities[5].Kind != nil || *entities[5].Count != -7 {
		t.Fatalf("archive: %+v %v", entities, err)
	}
	if _, err := db.UserBySession(ctx, []byte("old session"), now); !errors.Is(err, ErrNotFound) {
		t.Fatal("old session survived replacement")
	}
	var untrusted int
	if err := db.db.QueryRow(`SELECT COUNT(*) FROM sqlite_schema WHERE name IN ('source_only','schema_migrations')`).Scan(&untrusted); err != nil || untrusted != 0 {
		t.Fatal("adopted source schema")
	}
	recovery, _, err := readOnlyDatabase(filepath.Join(recoveryDir, result.RecoveryBackup))
	if err != nil {
		t.Fatal(err)
	}
	defer recovery.Close()
	var username string
	if err := recovery.QueryRow(`SELECT username FROM users WHERE id=1`).Scan(&username); err != nil || username != actor.Username {
		t.Fatal("recovery snapshot lost bootstrap admin")
	}
	after, err := os.ReadFile(path)
	if err != nil || sha256.Sum256(before) != sha256.Sum256(after) {
		t.Fatal("changed the Rails source")
	}
	if _, err := db.Restore(ctx, path, t.TempDir(), u, now); err != nil {
		t.Fatal("replacement cannot be repeated", err)
	}
}

func TestRestoreRailsValidationAndFailedReplacementLeaveLiveData(t *testing.T) {
	for _, test := range []struct{ name, sql string }{
		{"missing administrator", `UPDATE users SET admin=0`},
		{"missing entities", `DROP TABLE entities`},
		{"invalid credentials", `UPDATE users SET password_digest='bad hash'`},
		{"mixed credentials", `ALTER TABLE users ADD COLUMN password_hash TEXT`},
	} {
		t.Run(test.name, func(t *testing.T) {
			db, actor := adminFixture(t)
			path, _ := railsRestoreFixture(t)
			source, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := source.Exec(test.sql); err != nil {
				t.Fatal(err)
			}
			source.Close()
			if _, err := db.Restore(context.Background(), path, t.TempDir(), actor, time.Now()); !errors.Is(err, ErrInvalidBackup) {
				t.Fatalf("invalid Rails source: %v", err)
			}
			user, err := db.UserByID(context.Background(), actor.ID)
			if err != nil || user.Username != actor.Username {
				t.Fatal("invalid source changed live data")
			}
		})
	}
	db, actor := adminFixture(t)
	path, _ := railsRestoreFixture(t)
	if _, err := db.db.Exec(`CREATE TRIGGER fail_legacy_restore BEFORE INSERT ON users BEGIN SELECT RAISE(ABORT,'forced failure'); END`); err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	result, err := db.Restore(context.Background(), path, directory, actor, time.Now())
	if err == nil || result.RecoveryBackup == "" {
		t.Fatal("replacement failure omitted recovery snapshot")
	}
	u, err := db.UserByID(context.Background(), actor.ID)
	if err != nil || u.Username != actor.Username {
		t.Fatal("failed replacement changed the live user")
	}
	if _, err := os.Stat(filepath.Join(directory, result.RecoveryBackup)); err != nil {
		t.Fatal(err)
	}
}

func TestJSONReplacementRequiresExplicitAccessSetup(t *testing.T) {
	db, actor := adminFixture(t)
	path := jsonFixture(t, func(export map[string]any) { export["users"].([]any)[0].(map[string]any)["id"] = 1 })
	ctx := context.Background()
	for _, options := range []RestoreOptions{{}, {JSONAdminUsername: "missing", JSONAdminPassword: "new-password"}, {JSONAdminUsername: "quiet_player", JSONAdminPassword: "short"}} {
		if _, err := db.Restore(ctx, path, t.TempDir(), actor, time.Now(), options); !errors.Is(err, ErrInvalidBackup) {
			t.Fatalf("accepted invalid access setup: %v", err)
		}
		u, err := db.UserByID(ctx, 1)
		if err != nil || u.Username != actor.Username {
			t.Fatal("invalid JSON replacement changed current users")
		}
	}
	result, err := db.Restore(ctx, path, t.TempDir(), actor, time.Now(), RestoreOptions{JSONAdminUsername: "quiet_player", JSONAdminPassword: "new-password"})
	if err != nil || result.SourceFormat != "rails_json" || result.AdminUsername != "quiet_player" || result.Users != 2 || result.Entities != 6 {
		t.Fatalf("JSON replacement: %+v %v", result, err)
	}
	admin, err := db.UserByID(ctx, 73)
	if err != nil || !admin.Admin || bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte("new-password")) != nil {
		t.Fatal("selected administrator cannot sign in")
	}
	legacy, err := db.UserByID(ctx, 1)
	if err != nil || legacy.Username != "old_admin" || bcrypt.CompareHashAndPassword([]byte(legacy.PasswordHash), []byte("new-password")) == nil {
		t.Fatal("JSON IDs or credentials changed incorrectly")
	}
	items, total, err := db.ArchivedEntities(ctx, 1, 25, 0)
	if err != nil || total != 6 || items[0].CreatedAt != nil || items[0].Source != "json" {
		t.Fatal("JSON archive not preserved")
	}
	var leaked int
	if err := db.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM admin_audit WHERE instr(details,?)>0 OR instr(actor_username,?)>0`, "new-password", "new-password").Scan(&leaked); err != nil || leaked != 0 {
		t.Fatal("administrator password leaked into audit history")
	}
}
