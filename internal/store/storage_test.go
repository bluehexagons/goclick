package store

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestStorageCountsHistoryAndIncludesCommittedWALPages(t *testing.T) {
	db := openTestStore(t)
	ctx := context.Background()
	empty, err := db.Storage(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if empty.DatabaseBytes <= 0 || empty.ActivityRecords != 0 || empty.AuditRecords != 0 || empty.OldestActivityAt != nil {
		t.Fatalf("empty storage: %+v", empty)
	}
	user := createTestUser(t, db, "storage_player")
	if err := db.SetAdmin(ctx, user.ID, true, time.Now()); err != nil {
		t.Fatal(err)
	}
	// Keep the database's new pages in WAL until the measurement. This avoids
	// mistaking the possibly stale main file size for current allocation.
	if _, err := db.db.Exec(`PRAGMA wal_autocheckpoint=0;
		INSERT INTO admin_audit(actor_username,action,result,details,occurred_at)
		VALUES ('operator','storage_fixture','success',hex(zeroblob(32768)),'2026-10-15T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Increment(ctx, user.ID, time.Now()); err != nil {
		t.Fatal(err)
	}
	stats, err := db.Storage(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if stats.DatabaseBytes <= empty.DatabaseBytes || stats.ReusableBytes < 0 || stats.ReusableBytes > stats.DatabaseBytes ||
		stats.ActivityRecords != 2 || stats.AuditRecords != 2 || stats.OldestActivityAt == nil {
		t.Fatalf("populated storage: %+v", stats)
	}
	if _, err := parseTime(*stats.OldestActivityAt); err != nil {
		t.Fatal(err)
	}
	mainFile, err := os.Stat(dbPath(t, db))
	if err != nil {
		t.Fatal(err)
	}
	if stats.DatabaseBytes <= mainFile.Size() {
		t.Fatalf("allocation %d omitted committed WAL growth beyond main file size %d", stats.DatabaseBytes, mainFile.Size())
	}
	// Repeated inspection must leave gameplay and history intact.
	unchanged, err := db.Storage(ctx)
	if err != nil || unchanged.DatabaseBytes != stats.DatabaseBytes || unchanged.ActivityRecords != stats.ActivityRecords || unchanged.AuditRecords != stats.AuditRecords {
		t.Fatalf("storage inspection changed data: %+v, %v", unchanged, err)
	}
	counters, err := db.CurrentCounters(ctx, user.ID)
	if err != nil || counters.Clicks != 1 {
		t.Fatalf("storage inspection changed counters: %+v, %v", counters, err)
	}
}
