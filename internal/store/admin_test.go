package store

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func adminFixture(t *testing.T) (*Store, User) {
	t.Helper()
	db := openTestStore(t)
	user := createTestUser(t, db, "operator_user")
	if err := db.SetAdmin(context.Background(), user.ID, true, time.Now()); err != nil {
		t.Fatal(err)
	}
	user, err := db.UserByID(context.Background(), user.ID)
	if err != nil {
		t.Fatal(err)
	}
	return db, user
}

func TestAdminGrantRevokesSessionsAndProtectsLastAdmin(t *testing.T) {
	db := openTestStore(t)
	user := createTestUser(t, db, "promoted")
	ctx := context.Background()
	now := time.Now()
	token := []byte("existing session")
	if err := db.CreateSession(ctx, token, user.ID, now.Add(time.Hour), now); err != nil {
		t.Fatal(err)
	}
	if err := db.SetAdmin(ctx, user.ID, true, now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.UserBySession(ctx, token, now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("promotion retained session: %v", err)
	}
	if err := db.SetAdmin(ctx, user.ID, false, now); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("last admin revocation: %v", err)
	}
	second := createTestUser(t, db, "second_admin")
	if err := db.SetAdmin(ctx, second.ID, true, now); err != nil {
		t.Fatal(err)
	}
	other, err := Open(dbPath(t, db))
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	results := make(chan error, 2)
	var wg sync.WaitGroup
	wg.Go(func() { results <- db.SetAdmin(ctx, user.ID, false, now) })
	wg.Go(func() { results <- other.SetAdmin(ctx, second.ID, false, now) })
	wg.Wait()
	close(results)
	success, denied := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, ErrLastAdmin) {
			denied++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || denied != 1 {
		t.Fatalf("concurrent revocations: success=%d denied=%d", success, denied)
	}
}

func dbPath(t *testing.T, db *Store) string {
	t.Helper()
	var seq int
	var name, path string
	if err := db.db.QueryRow(`PRAGMA database_list`).Scan(&seq, &name, &path); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestAdminStatsAndActivity(t *testing.T) {
	db, user := adminFixture(t)
	ctx := context.Background()
	now := time.Now().UTC()
	player := createTestUser(t, db, "ordinary_player")
	for range 3 {
		if _, err := db.Increment(ctx, player.ID, now); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.CreateSession(ctx, []byte("admin session"), user.ID, now.Add(24*time.Hour), now); err != nil {
		t.Fatal(err)
	}
	stats, err := db.AdminOverview(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if stats.Players != 2 || stats.Admins != 1 || stats.Clicks != 3 || stats.Clicks24h != 3 || stats.ActivePlayers != 1 || len(stats.Daily) != 7 || stats.Daily[6].Clicks != 3 {
		t.Fatalf("stats: %+v", stats)
	}
	items, total, err := db.ListPlayers(ctx, "ordinary_", "clicks", 25, 0)
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(items) != 1 || items[0].Clicks != 3 {
		t.Fatalf("players: %+v total=%d", items, total)
	}
	events, total, err := db.Activity(ctx, player.ID, 2, 0)
	if err != nil {
		t.Fatal(err)
	}
	if total != 4 || len(events) != 2 || events[0].Action != "click" || *events[0].ClickCount != 3 {
		t.Fatalf("activity: %+v total=%d", events, total)
	}
	if _, err := db.UserBySession(ctx, []byte("admin session"), now.Add(AdminSessionTTL)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("admin session exceeded lifetime: %v", err)
	}
}

func TestBackupRestorePreservesDataAndRevokesSessions(t *testing.T) {
	db, user := adminFixture(t)
	ctx := context.Background()
	now := time.Now().UTC()
	if _, err := db.Increment(ctx, user.ID, now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.db.Exec(`INSERT INTO rails_entities(id,user_id,kind,count,created_at,updated_at) VALUES(11,?,'custom_bonus',7,?,?),(12,?,NULL,NULL,?,?)`, user.ID, formatTime(now), formatTime(now), user.ID, formatTime(now), formatTime(now)); err != nil {
		t.Fatal(err)
	}
	if err := db.CreateSession(ctx, []byte("old token"), user.ID, now.Add(time.Hour), now); err != nil {
		t.Fatal(err)
	}
	snapshot, err := db.Backup(ctx, t.TempDir(), "saved")
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(snapshot)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("snapshot permissions: %v %v", info, err)
	}
	if _, err := db.Increment(ctx, user.ID, now); err != nil {
		t.Fatal(err)
	}
	createTestUser(t, db, "after_backup")
	result, err := db.Restore(ctx, snapshot, t.TempDir(), user, now)
	if err != nil {
		t.Fatal(err)
	}
	if result.Users != 1 || result.Entities != 2 || !strings.HasPrefix(result.RecoveryBackup, "pre-restore-") {
		t.Fatalf("restore: %+v", result)
	}
	restored, err := db.UserByID(ctx, user.ID)
	if err != nil || restored.PasswordHash != user.PasswordHash || !restored.Admin || !restored.CreatedAt.Equal(user.CreatedAt) {
		t.Fatalf("restored user: %+v %v", restored, err)
	}
	counters, err := db.CurrentCounters(ctx, user.ID)
	if err != nil || counters.Clicks != 1 {
		t.Fatalf("restored counters: %+v %v", counters, err)
	}
	entities, total, err := db.ArchivedEntities(ctx, user.ID, 25, 0)
	if err != nil || total != 2 || entities[1].Kind != nil || entities[1].Count != nil || *entities[0].Kind != "custom_bonus" {
		t.Fatalf("archive: %+v %v", entities, err)
	}
	if _, err := db.UserBySession(ctx, []byte("old token"), now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("restored revoked session: %v", err)
	}
	audit, _, err := db.Audit(ctx, 25, 0)
	if err != nil || audit[0].Action != "backup_restore" {
		t.Fatalf("audit: %+v %v", audit, err)
	}
	// The uploaded original keeps its sessions and rows unchanged.
	raw, _, err := readOnlyDatabase(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	var count int
	if err := raw.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("modified input backup: %d %v", count, err)
	}
}

func TestRestoreTransactionFailurePreservesLiveData(t *testing.T) {
	db, user := adminFixture(t)
	ctx := context.Background()
	snapshot, err := db.Backup(ctx, t.TempDir(), "good")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Increment(ctx, user.ID, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := db.db.Exec(`CREATE TRIGGER fail_restore BEFORE INSERT ON users BEGIN SELECT RAISE(ABORT,'forced restore failure'); END`); err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	result, err := db.Restore(ctx, snapshot, directory, user, time.Now())
	if err == nil {
		t.Fatal("restore unexpectedly succeeded")
	}
	if result.RecoveryBackup == "" {
		t.Fatal("failure omitted recovery snapshot")
	}
	if _, err := os.Stat(filepath.Join(directory, result.RecoveryBackup)); err != nil {
		t.Fatal(err)
	}
	counters, err := db.CurrentCounters(ctx, user.ID)
	if err != nil || counters.Clicks != 1 {
		t.Fatalf("failed restore changed counters: %+v %v", counters, err)
	}
	if _, err := db.UserByID(ctx, user.ID); err != nil {
		t.Fatal("failed restore removed live user", err)
	}
}

func TestRestoreRejectsUntrustedAndInvalidBackups(t *testing.T) {
	for _, test := range []struct{ name, sql string }{
		{"trigger", `CREATE TRIGGER uploaded AFTER INSERT ON users BEGIN DELETE FROM counters; END`},
		{"view", `CREATE VIEW uploaded AS SELECT * FROM users`},
		{"extra table", `CREATE TABLE uploaded(value TEXT)`},
		{"future schema", `PRAGMA user_version=999`},
		{"no administrator", `UPDATE users SET admin=0`},
		{"bad credentials", `UPDATE users SET password_hash='malformed'`},
		{"bad timestamp", `UPDATE counters SET last_clicked_at='invalid'`},
		{"invalid counter type", `UPDATE counters SET click_count='not a number'`},
		{"orphan", `PRAGMA foreign_keys=OFF; INSERT INTO counters(user_id) VALUES(999)`},
	} {
		t.Run(test.name, func(t *testing.T) {
			db, user := adminFixture(t)
			ctx := context.Background()
			if _, err := db.Increment(ctx, user.ID, time.Now()); err != nil {
				t.Fatal(err)
			}
			snapshot, err := db.Backup(ctx, t.TempDir(), "invalid")
			if err != nil {
				t.Fatal(err)
			}
			raw, err := sql.Open("sqlite", snapshot)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := raw.Exec(test.sql); err != nil {
				t.Fatal(err)
			}
			raw.Close()
			if _, err := db.Restore(ctx, snapshot, t.TempDir(), user, time.Now()); !errors.Is(err, ErrInvalidBackup) {
				t.Fatalf("accepted invalid backup: %v", err)
			}
			counters, err := db.CurrentCounters(ctx, user.ID)
			if err != nil || counters.Clicks != 1 {
				t.Fatalf("invalid upload changed live database: %+v %v", counters, err)
			}
		})
	}
}

func TestVersionTwoBackupCanBeRestored(t *testing.T) {
	db, user := adminFixture(t)
	ctx := context.Background()
	snapshot, err := db.Backup(ctx, t.TempDir(), "v2")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := sql.Open("sqlite", snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`DROP TABLE player_activity; DROP TABLE admin_audit; PRAGMA user_version=2`); err != nil {
		t.Fatal(err)
	}
	raw.Close()
	if _, err := db.Restore(ctx, snapshot, t.TempDir(), user, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Increment(ctx, user.ID, time.Now()); err != nil {
		t.Fatal("v2 restore lost current schema", err)
	}
}
