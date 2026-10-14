package store

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

// JSON exports cannot supply a usable administrator password. Replacement
// requires explicit access setup for one of their existing source accounts.
type RestoreOptions struct {
	JSONAdminUsername string
	JSONAdminPassword string
}

// prepareRestoreSource converts legacy data in isolation. Only a Go Click
// snapshot with the trusted schema can reach the live replacement transaction.
func prepareRestoreSource(ctx context.Context, path string, actor User, now time.Time, options RestoreOptions) (string, string, string, func(), error) {
	noop := func() {}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return "", "", "", noop, fmt.Errorf("%w: source must be an existing regular file", ErrInvalidBackup)
	}
	file, err := os.Open(path)
	if err != nil {
		return "", "", "", noop, fmt.Errorf("%w: %v", ErrInvalidBackup, err)
	}
	header := make([]byte, 16)
	_, readErr := io.ReadFull(file, header)
	file.Close()
	if readErr != nil && !errors.Is(readErr, io.EOF) && !errors.Is(readErr, io.ErrUnexpectedEOF) {
		return "", "", "", noop, fmt.Errorf("%w: %v", ErrInvalidBackup, readErr)
	}
	format := "rails_json"
	if string(header) == "SQLite format 3\x00" {
		db, _, err := readOnlyDatabase(path)
		if err != nil {
			return "", "", "", noop, fmt.Errorf("%w: %v", ErrInvalidBackup, err)
		}
		rows, err := db.QueryContext(ctx, `PRAGMA table_info(users)`)
		if err != nil {
			db.Close()
			return "", "", "", noop, fmt.Errorf("%w: %v", ErrInvalidBackup, err)
		}
		var hash, digest bool
		for rows.Next() {
			var cid, notNull, primaryKey int
			var name, kind string
			var defaultValue any
			if err = rows.Scan(&cid, &name, &kind, &notNull, &defaultValue, &primaryKey); err != nil {
				break
			}
			hash = hash || name == "password_hash"
			digest = digest || name == "password_digest"
		}
		if err == nil {
			err = rows.Err()
		}
		rows.Close()
		db.Close()
		if err != nil {
			return "", "", "", noop, fmt.Errorf("%w: %v", ErrInvalidBackup, err)
		}
		if hash && !digest {
			return path, "goclick", "", noop, nil
		}
		if !digest || hash {
			return "", "", "", noop, fmt.Errorf("%w: expected a Go Click backup or Rails primary SQLite database", ErrInvalidBackup)
		}
		format = "rails_sqlite"
	}
	if format == "rails_json" {
		if info.Size() > MaxRailsJSONBytes {
			return "", "", "", noop, fmt.Errorf("%w: Rails JSON export exceeds 16 MiB", ErrInvalidBackup)
		}
		if options.JSONAdminUsername == "" || len(options.JSONAdminPassword) < 8 || len(options.JSONAdminPassword) > 72 {
			return "", "", "", noop, fmt.Errorf("%w: JSON replacement requires an imported administrator username and a new password of 8–72 bytes", ErrInvalidBackup)
		}
	}
	directory, err := os.MkdirTemp("", "goclick-legacy-restore-")
	if err != nil {
		return "", "", "", noop, err
	}
	cleanup := func() { os.RemoveAll(directory) }
	staged, err := Open(filepath.Join(directory, "staged.db"))
	if err != nil {
		cleanup()
		return "", "", "", noop, err
	}
	ready := false
	defer func() {
		staged.Close()
		if !ready {
			cleanup()
		}
	}()
	audit := ImportAudit{Actor: actor, Now: now}
	if format == "rails_sqlite" {
		_, err = staged.ImportRails(ctx, path, audit)
	} else {
		_, err = staged.ImportRailsJSON(ctx, path, audit)
	}
	if err != nil {
		return "", "", "", noop, fmt.Errorf("%w: %v", ErrInvalidBackup, err)
	}
	adminUsername := ""
	if format == "rails_json" {
		user, err := staged.UserByUsername(ctx, options.JSONAdminUsername)
		if err != nil || user.Username != options.JSONAdminUsername {
			return "", "", "", noop, fmt.Errorf("%w: administrator username must identify an account in the JSON export", ErrInvalidBackup)
		}
		if err := staged.SetPassword(ctx, user.ID, options.JSONAdminPassword, now); err != nil {
			return "", "", "", noop, err
		}
		if err := staged.SetAdmin(ctx, user.ID, true, now); err != nil {
			return "", "", "", noop, err
		}
		adminUsername = user.Username
	}
	var admins int
	if err := staged.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE admin=1`).Scan(&admins); err != nil {
		return "", "", "", noop, err
	}
	if admins == 0 {
		return "", "", "", noop, fmt.Errorf("%w: Rails database has no administrator; import into an isolated Go Click database and grant access there before restoring it", ErrInvalidBackup)
	}
	snapshot, err := staged.Backup(ctx, directory, "converted")
	if err != nil {
		return "", "", "", noop, err
	}
	ready = true
	return snapshot, format, adminUsername, cleanup, nil
}
