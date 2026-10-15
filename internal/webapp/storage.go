package webapp

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/bluehexagons/goclick/internal/store"
)

type recoverySnapshotStats struct {
	Count     int64      `json:"count"`
	Bytes     int64      `json:"bytes"`
	Oversized int64      `json:"oversized"`
	OldestAt  *time.Time `json:"oldest_at"`
	NewestAt  *time.Time `json:"newest_at"`
}

type adminStorageResponse struct {
	store.StorageStats
	RecoverySnapshots *recoverySnapshotStats `json:"recovery_snapshots"`
	RestoreLimitBytes int64                  `json:"restore_limit_bytes"`
}

func (a *App) adminStorage(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	stats, err := a.store.Storage(ctx)
	if err != nil {
		a.internalError(w, r, "read storage statistics", err)
		return
	}
	snapshots, err := recoverySnapshots(ctx, a.backupDir)
	if err != nil {
		// A failed directory scan must not look like zero recovery files. Keep
		// database statistics usable without exposing private filesystem paths.
		a.logger.Warn("read recovery snapshot statistics", "error", err)
	}
	writeJSON(w, http.StatusOK, adminStorageResponse{stats, snapshots, maxBackupBytes})
}

func recoverySnapshots(ctx context.Context, directory string) (*recoverySnapshotStats, error) {
	out := &recoverySnapshotStats{}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	dir, err := os.Open(directory)
	if errors.Is(err, fs.ErrNotExist) {
		// A new directory can legitimately be absent before the first backup.
		// A dangling configured link (including in a parent component) instead
		// means the recovery location is unavailable, not empty.
		for candidate := filepath.Clean(directory); ; candidate = filepath.Dir(candidate) {
			_, inspectErr := os.Lstat(candidate)
			if inspectErr == nil {
				ancestor, resolveErr := os.Stat(candidate)
				if resolveErr != nil {
					return nil, resolveErr
				}
				if !ancestor.IsDir() {
					return nil, err
				}
				return out, nil
			}
			if !errors.Is(inspectErr, fs.ErrNotExist) || filepath.Dir(candidate) == candidate {
				return nil, inspectErr
			}
		}
	}
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		// Bound memory even when an operator has retained many snapshots.
		entries, err := dir.ReadDir(128)
		if err != nil && !errors.Is(err, io.EOF) {
			return nil, err
		}
		for _, entry := range entries {
			name := entry.Name()
			if (!strings.HasPrefix(name, "pre-import-") && !strings.HasPrefix(name, "pre-restore-")) ||
				!strings.HasSuffix(name, ".db") || !entry.Type().IsRegular() {
				continue
			}
			info, err := entry.Info()
			if errors.Is(err, fs.ErrNotExist) {
				continue // Another operator may have moved an old snapshot.
			}
			if err != nil {
				return nil, err
			}
			if !info.Mode().IsRegular() {
				continue
			}
			out.Count++
			out.Bytes += info.Size()
			if info.Size() > maxBackupBytes {
				out.Oversized++
			}
			modified := info.ModTime().UTC()
			if out.OldestAt == nil || modified.Before(*out.OldestAt) {
				out.OldestAt = &modified
			}
			if out.NewestAt == nil || modified.After(*out.NewestAt) {
				out.NewestAt = &modified
			}
		}
		if errors.Is(err, io.EOF) {
			return out, nil
		}
	}
}
