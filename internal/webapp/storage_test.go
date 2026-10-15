package webapp

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRecoverySnapshotInventoryExcludesUnrelatedFilesAndLinks(t *testing.T) {
	directory := t.TempDir()
	oldest := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	newest := oldest.Add(24 * time.Hour)
	for _, test := range []struct {
		name string
		size int64
		when time.Time
	}{
		{"pre-restore-old.db", 12, oldest},
		{"pre-import-new.db", maxBackupBytes + 1, newest},
		{"goclick.db", 20, oldest},
		{"pre-restore-old.db-wal", 10, oldest},
		{"notes.txt", 10, oldest},
	} {
		path := filepath.Join(directory, test.name)
		file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			t.Fatal(err)
		}
		err = file.Truncate(test.size) // Sparse oversized fixture, not 128 MiB of data.
		file.Close()
		if err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, test.when, test.when); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(directory, "pre-restore-directory.db"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(directory, "goclick.db"), filepath.Join(directory, "pre-restore-link.db")); err != nil {
		t.Fatal(err)
	}
	stats, err := recoverySnapshots(context.Background(), directory)
	if err != nil || stats == nil {
		t.Fatal(err)
	}
	if stats.Count != 2 || stats.Bytes != maxBackupBytes+13 || stats.Oversized != 1 ||
		stats.OldestAt == nil || !stats.OldestAt.Equal(oldest) || stats.NewestAt == nil || !stats.NewestAt.Equal(newest) {
		t.Fatalf("inventory: %+v", stats)
	}
	for _, path := range []string{"missing", "goclick.db"} {
		stats, err := recoverySnapshots(context.Background(), filepath.Join(directory, path))
		if path == "missing" {
			if err != nil || stats == nil || stats.Count != 0 || stats.Bytes != 0 || stats.OldestAt != nil {
				t.Fatalf("missing directory: %+v, %v", stats, err)
			}
		} else if err == nil || stats != nil {
			t.Fatalf("unreadable directory reported as empty: %+v, %v", stats, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if stats, err := recoverySnapshots(ctx, directory); !errors.Is(err, context.Canceled) || stats != nil {
		t.Fatalf("cancelled inventory: %+v, %v", stats, err)
	}
}

func TestAdminStorageReportsPartialFailuresWithoutLeakingPaths(t *testing.T) {
	app, db, client, _ := adminTestApp(t)
	if _, err := db.Backup(context.Background(), app.backupDir, "pre-restore-test"); err != nil {
		t.Fatal(err)
	}
	response := jsonRequest(t, client, "GET", "http://goclick.test/api/admin/storage", nil, nil)
	if response.StatusCode != http.StatusOK || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("storage response: %d", response.StatusCode)
	}
	var result adminStorageResponse
	decodeResponse(t, response, &result)
	if result.DatabaseBytes <= 0 || result.ActivityRecords != 2 || result.AuditRecords != 1 || result.RecoverySnapshots == nil ||
		result.RecoverySnapshots.Count != 1 || result.RecoverySnapshots.Bytes <= 0 || result.RestoreLimitBytes != maxBackupBytes {
		t.Fatalf("storage response: %+v", result)
	}
	app.backupDir = filepath.Join(t.TempDir(), "private-path.txt")
	if err := os.WriteFile(app.backupDir, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	response = jsonRequest(t, client, "GET", "http://goclick.test/api/admin/storage", nil, nil)
	body := readBody(t, response)
	if response.StatusCode != http.StatusOK || !strings.Contains(body, `"recovery_snapshots":null`) ||
		strings.Contains(body, "private-path") || strings.Contains(body, app.backupDir) {
		t.Fatalf("partial storage response: %d %s", response.StatusCode, body)
	}
}
