package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

var ErrInvalidBackup = errors.New("invalid database upload")
var backupHashPattern = regexp.MustCompile(`^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$`)

// Backup creates a consistent standalone SQLite snapshot in a private file.
// VACUUM INTO preserves explicit primary keys and includes committed WAL data.
func (s *Store) Backup(ctx context.Context, directory, prefix string) (string, error) {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", err
	}
	file, err := os.CreateTemp(directory, prefix+"-*.db")
	if err != nil {
		return "", err
	}
	name := file.Name()
	if err := file.Close(); err != nil {
		os.Remove(name)
		return "", err
	}
	absolute, err := filepath.Abs(name)
	if err != nil {
		os.Remove(name)
		return "", err
	}
	// A URI prevents '?' and '#' in a configured directory from changing the
	// destination filename. The SQL expression is bound, never interpolated.
	destination := (&url.URL{Scheme: "file", Path: filepath.ToSlash(absolute)}).String()
	if _, err := s.db.ExecContext(ctx, `VACUUM INTO ?`, destination); err != nil {
		os.Remove(name)
		return "", fmt.Errorf("snapshot database: %w", err)
	}
	file, err = os.Open(name)
	if err != nil {
		os.Remove(name)
		return "", err
	}
	err = file.Sync()
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		os.Remove(name)
		return "", err
	}
	dir, err := os.Open(directory)
	if err != nil {
		os.Remove(name)
		return "", err
	}
	err = dir.Sync()
	closeErr = dir.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		os.Remove(name)
		return "", err
	}
	return name, nil
}

func readOnlyDatabase(path string) (*sql.DB, string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, "", err
	}
	u := &url.URL{Scheme: "file", Path: filepath.ToSlash(absolute)}
	q := u.Query()
	q.Set("mode", "ro")
	u.RawQuery = q.Encode()
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, "", err
	}
	db.SetMaxOpenConns(1)
	return db, u.String(), nil
}

func validateBackup(ctx context.Context, db *sql.DB) (int, error) {
	version, err := existingSchemaVersion(ctx, db)
	if err != nil {
		return 0, err
	}
	if version < 2 || version > schemaVersion {
		return 0, fmt.Errorf("unsupported schema version %d", version)
	}
	// Compare every executable schema object with a database built by this
	// release. Never adopt uploaded DDL, triggers, views, or virtual tables.
	trusted, err := Open(":memory:")
	if err != nil {
		return 0, err
	}
	defer trusted.Close()
	expected, err := schemaObjects(ctx, trusted.db)
	if err != nil {
		return 0, err
	}
	actual, err := schemaObjects(ctx, db)
	if err != nil {
		return 0, err
	}
	if version == 2 {
		for key := range expected {
			if strings.HasPrefix(key, "player_activity") || key == "admin_audit" {
				delete(expected, key)
			}
		}
	}
	if version < 4 {
		delete(expected, "rails_json_users")
	}
	if version < 5 {
		delete(expected, "player_activity_sign_in")
	}
	if len(expected) != len(actual) {
		return 0, errors.New("unexpected schema objects")
	}
	for name, want := range expected {
		if actual[name] != want {
			return 0, fmt.Errorf("incompatible schema object %s", name)
		}
	}
	var check string
	if err := db.QueryRowContext(ctx, `PRAGMA integrity_check`).Scan(&check); err != nil {
		return 0, err
	}
	if check != "ok" {
		return 0, errors.New("database integrity check failed")
	}
	rows, err := db.QueryContext(ctx, `PRAGMA foreign_key_check`)
	if err != nil {
		return 0, err
	}
	bad := rows.Next()
	rowErr := rows.Err()
	rows.Close()
	if rowErr != nil {
		return 0, rowErr
	}
	if bad {
		return 0, errors.New("database has foreign-key violations")
	}
	var admins, invalid int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE admin=1`).Scan(&admins); err != nil {
		return 0, err
	}
	if admins == 0 {
		return 0, errors.New("backup must contain an administrator; grant access on an isolated copy first")
	}
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE id<=0 OR admin NOT IN (0,1) OR username=''`).Scan(&invalid); err != nil {
		return 0, err
	}
	if invalid != 0 {
		return 0, errors.New("backup contains invalid user records")
	}
	checks := []string{
		`SELECT COUNT(*) FROM users WHERE typeof(username)!='text' OR typeof(password_hash)!='text' OR typeof(admin)!='integer' OR typeof(created_at)!='text' OR typeof(updated_at)!='text' OR typeof(email) NOT IN ('text','null')`,
		`SELECT COUNT(*) FROM counters WHERE typeof(user_id)!='integer' OR typeof(click_count)!='integer' OR typeof(day_streak)!='integer' OR typeof(month_streak)!='integer' OR typeof(year_streak)!='integer' OR typeof(last_clicked_at) NOT IN ('text','null')`,
		`SELECT COUNT(*) FROM rails_entities WHERE typeof(user_id)!='integer' OR typeof(kind) NOT IN ('text','null') OR typeof(count) NOT IN ('integer','null') OR typeof(created_time) NOT IN ('text','null') OR typeof(modified_time) NOT IN ('text','null') OR typeof(created_at)!='text' OR typeof(updated_at)!='text'`,
	}
	if version >= 3 {
		checks = append(checks,
			`SELECT COUNT(*) FROM player_activity WHERE typeof(user_id)!='integer' OR typeof(action)!='text' OR typeof(occurred_at)!='text' OR typeof(click_count) NOT IN ('integer','null')`,
			`SELECT COUNT(*) FROM admin_audit WHERE typeof(actor_id) NOT IN ('integer','null') OR typeof(target_user_id) NOT IN ('integer','null') OR typeof(actor_username)!='text' OR typeof(action)!='text' OR typeof(result)!='text' OR typeof(details)!='text' OR typeof(occurred_at)!='text'`)
	}
	if version >= 4 {
		checks = append(checks, `SELECT COUNT(*) FROM rails_json_users WHERE typeof(user_id)!='integer' OR typeof(payload)!='text' OR NOT json_valid(payload)`)
	}
	for _, query := range checks {
		if err := db.QueryRowContext(ctx, query).Scan(&invalid); err != nil {
			return 0, err
		}
		if invalid != 0 {
			return 0, errors.New("backup contains invalid field types")
		}
	}
	users, err := db.QueryContext(ctx, `SELECT id,username,email,password_hash,admin,created_at,updated_at FROM users`)
	if err != nil {
		return 0, err
	}
	for users.Next() {
		user, err := scanUser(users)
		if err == nil {
			var cost int
			cost, err = bcrypt.Cost([]byte(user.PasswordHash))
			if err == nil && (cost > maxImportedBcryptCost || !backupHashPattern.MatchString(user.PasswordHash)) {
				err = errors.New("invalid or excessive-cost password hash")
			}
		}
		if err != nil {
			users.Close()
			return 0, errors.New("backup contains invalid user credentials or timestamps")
		}
	}
	rowErr = users.Err()
	users.Close()
	if rowErr != nil {
		return 0, rowErr
	}
	entities, err := db.QueryContext(ctx, `SELECT id,user_id,kind,count,created_time,modified_time,created_at,updated_at FROM rails_entities`)
	if err != nil {
		return 0, err
	}
	for entities.Next() {
		if _, err := scanRailsEntity(entities); err != nil {
			entities.Close()
			return 0, errors.New("backup contains invalid archive timestamps")
		}
	}
	rowErr = entities.Err()
	entities.Close()
	if rowErr != nil {
		return 0, rowErr
	}
	if version >= 4 {
		rows, err := db.QueryContext(ctx, `SELECT user_id,payload FROM rails_json_users`)
		if err != nil {
			return 0, err
		}
		for rows.Next() {
			var id int64
			var payload string
			if err := rows.Scan(&id, &payload); err != nil {
				rows.Close()
				return 0, err
			}
			if err := validateJSONArchive(id, []byte(payload)); err != nil {
				rows.Close()
				return 0, fmt.Errorf("invalid JSON archive: %w", err)
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return 0, err
		}
		var duplicates int
		if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM (SELECT id FROM (`+entityArchiveQuery+`) GROUP BY id HAVING COUNT(*)>1)`).Scan(&duplicates); err != nil {
			return 0, err
		}
		if duplicates != 0 {
			return 0, errors.New("conflicting archived entity IDs")
		}
	}
	timestamps, err := db.QueryContext(ctx, `SELECT last_clicked_at FROM counters WHERE last_clicked_at IS NOT NULL`)
	if err != nil {
		return 0, err
	}
	for timestamps.Next() {
		var value string
		if err := timestamps.Scan(&value); err != nil {
			timestamps.Close()
			return 0, err
		}
		if _, err := parseTime(value); err != nil {
			timestamps.Close()
			return 0, errors.New("backup contains invalid click timestamps")
		}
	}
	rowErr = timestamps.Err()
	timestamps.Close()
	if rowErr != nil {
		return 0, rowErr
	}
	if version >= 3 {
		rows, err := db.QueryContext(ctx, `SELECT occurred_at FROM player_activity UNION ALL SELECT occurred_at FROM admin_audit`)
		if err != nil {
			return 0, err
		}
		for rows.Next() {
			var value string
			if err := rows.Scan(&value); err != nil {
				rows.Close()
				return 0, err
			}
			if _, err := parseTime(value); err != nil {
				rows.Close()
				return 0, errors.New("backup contains invalid activity timestamps")
			}
		}
		rowErr = rows.Err()
		rows.Close()
		if rowErr != nil {
			return 0, rowErr
		}
	}
	return version, nil
}

func schemaObjects(ctx context.Context, db *sql.DB) (map[string]string, error) {
	rows, err := db.QueryContext(ctx, `SELECT name,type,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]string)
	for rows.Next() {
		var name, kind, statement string
		if err := rows.Scan(&name, &kind, &statement); err != nil {
			return nil, err
		}
		out[name] = kind + ":" + strings.Join(strings.Fields(statement), " ")
	}
	return out, rows.Err()
}

type RestoreResult struct {
	RecoveryBackup string `json:"recovery_backup"`
	Users          int64  `json:"users"`
	Entities       int64  `json:"entities"`
	SourceFormat   string `json:"source_format"`
	AdminUsername  string `json:"admin_username,omitempty"`
}

// Restore imports only known data columns into the live, trusted schema. The
// caller must quiesce HTTP requests through authentication and execution so a
// previously authenticated request cannot act on a restored user's reused ID.
func (s *Store) Restore(ctx context.Context, path, recoveryDirectory string, actor User, now time.Time, settings ...RestoreOptions) (RestoreResult, error) {
	var result RestoreResult
	var options RestoreOptions
	if len(settings) > 0 {
		options = settings[0]
	}
	prepared, format, adminUsername, cleanup, err := prepareRestoreSource(ctx, path, actor, now, options)
	if err != nil {
		return result, err
	}
	defer cleanup()
	result.SourceFormat, result.AdminUsername = format, adminUsername
	source, uri, err := readOnlyDatabase(prepared)
	if err != nil {
		return result, fmt.Errorf("%w: %v", ErrInvalidBackup, err)
	}
	version, err := validateBackup(ctx, source)
	source.Close()
	if err != nil {
		return result, fmt.Errorf("%w: %v", ErrInvalidBackup, err)
	}
	recovery, err := s.Backup(ctx, recoveryDirectory, "pre-restore-"+now.UTC().Format("20060102T150405Z"))
	if err != nil {
		return result, fmt.Errorf("save recovery backup: %w", err)
	}
	result.RecoveryBackup = filepath.Base(recovery)
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return result, err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `ATTACH DATABASE ? AS restore_source`, uri); err != nil {
		return result, err
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := conn.ExecContext(cleanup, `DETACH DATABASE restore_source`); err != nil {
			// Do not return an attached source to the pool after cancellation.
			conn.Raw(func(any) error { return driver.ErrBadConn })
		}
	}()
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions; DELETE FROM player_activity; DELETE FROM rails_entities; DELETE FROM counters; DELETE FROM users;`); err != nil {
		return result, err
	}
	for _, table := range []schemaTable{coreSchemaTables[0], coreSchemaTables[1], archiveSchemaTable} {
		columns := strings.Join(table.columns, ",")
		if _, err := tx.ExecContext(ctx, `INSERT INTO main.`+table.name+` (`+columns+`) SELECT `+columns+` FROM restore_source.`+table.name); err != nil {
			return result, fmt.Errorf("restore %s: %w", table.name, err)
		}
	}
	if version >= 3 {
		if _, err := tx.ExecContext(ctx, `INSERT INTO main.player_activity SELECT id,user_id,action,occurred_at,click_count FROM restore_source.player_activity`); err != nil {
			return result, err
		}
		// Retain live audit history, and merge older snapshot history without
		// reusing its IDs or erasing actions performed since that snapshot.
		if _, err := tx.ExecContext(ctx, `INSERT INTO main.admin_audit(actor_id,actor_username,action,target_user_id,result,details,occurred_at)
			SELECT b.actor_id,b.actor_username,b.action,b.target_user_id,b.result,b.details,b.occurred_at FROM restore_source.admin_audit b
			WHERE NOT EXISTS(SELECT 1 FROM main.admin_audit a WHERE a.actor_id IS b.actor_id AND a.actor_username=b.actor_username AND a.action=b.action AND a.target_user_id IS b.target_user_id AND a.result=b.result AND a.details=b.details AND a.occurred_at=b.occurred_at)`); err != nil {
			return result, err
		}
	}
	if version >= 4 {
		if _, err := tx.ExecContext(ctx, `INSERT INTO main.rails_json_users SELECT user_id,payload FROM restore_source.rails_json_users`); err != nil {
			return result, err
		}
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&result.Users); err != nil {
		return result, err
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM (`+entityArchiveQuery+`)`).Scan(&result.Entities); err != nil {
		return result, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO admin_audit(actor_id,actor_username,action,result,details,occurred_at) VALUES (?,?,'backup_restore','success',?,?)`, actor.ID, actor.Username, format+": "+result.RecoveryBackup, formatTime(now)); err != nil {
		return result, err
	}
	if err := tx.Commit(); err != nil {
		return result, err
	}
	return result, nil
}
