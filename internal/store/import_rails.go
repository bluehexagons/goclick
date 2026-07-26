package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
)

type ImportResult struct {
	Users    int
	Counters int
}

// ImportRails copies the Minimal Clicker users and entity counters from a Rails
// SQLite database. Rails' has_secure_password and Go's bcrypt package use the
// same bcrypt hash format, so password_digest can be preserved verbatim.
func (s *Store) ImportRails(ctx context.Context, sourcePath string) (ImportResult, error) {
	absolute, err := filepath.Abs(sourcePath)
	if err != nil {
		return ImportResult{}, fmt.Errorf("resolve source path: %w", err)
	}
	source, err := sql.Open("sqlite", "file:"+absolute+"?mode=ro")
	if err != nil {
		return ImportResult{}, fmt.Errorf("open Rails database: %w", err)
	}
	defer source.Close()
	source.SetMaxOpenConns(1)

	if err := validateRailsSchema(ctx, source); err != nil {
		return ImportResult{}, err
	}

	rows, err := source.QueryContext(ctx, `
		SELECT id, username, email, password_digest, admin, created_at, updated_at
		FROM users ORDER BY id`)
	if err != nil {
		return ImportResult{}, fmt.Errorf("read Rails users: %w", err)
	}
	defer rows.Close()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ImportResult{}, fmt.Errorf("begin import: %w", err)
	}
	defer tx.Rollback()

	var result ImportResult
	for rows.Next() {
		var (
			id                   int64
			username             string
			email, passwordHash  sql.NullString
			admin                bool
			createdAt, updatedAt string
		)
		if err := rows.Scan(&id, &username, &email, &passwordHash, &admin, &createdAt, &updatedAt); err != nil {
			return ImportResult{}, fmt.Errorf("scan Rails user: %w", err)
		}
		if !passwordHash.Valid || passwordHash.String == "" {
			return ImportResult{}, fmt.Errorf("Rails user %d (%s) has no password digest", id, username)
		}
		createdAt, err = normalizeImportedTime(createdAt)
		if err != nil {
			return ImportResult{}, fmt.Errorf("Rails user %d (%s) has invalid created_at: %w", id, username, err)
		}
		updatedAt, err = normalizeImportedTime(updatedAt)
		if err != nil {
			return ImportResult{}, fmt.Errorf("Rails user %d (%s) has invalid updated_at: %w", id, username, err)
		}
		var emailValue any
		if email.Valid && email.String != "" {
			emailValue = email.String
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO users (id, username, email, password_hash, admin, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				username = excluded.username,
				email = excluded.email,
				password_hash = excluded.password_hash,
				admin = excluded.admin,
				created_at = excluded.created_at,
				updated_at = excluded.updated_at`,
			id, username, emailValue, passwordHash.String, admin, createdAt, updatedAt); err != nil {
			return ImportResult{}, fmt.Errorf("import Rails user %d (%s): %w", id, username, err)
		}
		result.Users++
	}
	if err := rows.Err(); err != nil {
		return ImportResult{}, fmt.Errorf("iterate Rails users: %w", err)
	}

	entityRows, err := source.QueryContext(ctx, `
		SELECT
			user_id,
			MAX(CASE WHEN kind = 'click_count' THEN count END),
			MAX(CASE WHEN kind = 'streak_counter_day' THEN count END),
			MAX(CASE WHEN kind = 'streak_counter_month' THEN count END),
			MAX(CASE WHEN kind = 'streak_counter_year' THEN count END),
			MAX(CASE WHEN kind = 'click_count' THEN COALESCE(modified_time, updated_at) END)
		FROM entities
		GROUP BY user_id
		ORDER BY user_id`)
	if err != nil {
		return ImportResult{}, fmt.Errorf("read Rails counters: %w", err)
	}
	defer entityRows.Close()

	for entityRows.Next() {
		var (
			userID                   int64
			clicks, day, month, year sql.NullInt64
			lastClicked              sql.NullString
		)
		if err := entityRows.Scan(&userID, &clicks, &day, &month, &year, &lastClicked); err != nil {
			return ImportResult{}, fmt.Errorf("scan Rails counters: %w", err)
		}
		var lastClickedValue any
		if lastClicked.Valid {
			normalized, err := normalizeImportedTime(lastClicked.String)
			if err != nil {
				return ImportResult{}, fmt.Errorf("Rails counters for user %d have invalid modified_time: %w", userID, err)
			}
			lastClickedValue = normalized
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO counters (user_id, click_count, day_streak, month_streak, year_streak, last_clicked_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(user_id) DO UPDATE SET
				click_count = excluded.click_count,
				day_streak = excluded.day_streak,
				month_streak = excluded.month_streak,
				year_streak = excluded.year_streak,
				last_clicked_at = excluded.last_clicked_at`,
			userID, nullInt(clicks), nullInt(day), nullInt(month), nullInt(year), lastClickedValue); err != nil {
			return ImportResult{}, fmt.Errorf("import Rails counters for user %d: %w", userID, err)
		}
		result.Counters++
	}
	if err := entityRows.Err(); err != nil {
		return ImportResult{}, fmt.Errorf("iterate Rails counters: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return ImportResult{}, fmt.Errorf("commit Rails import: %w", err)
	}
	return result, nil
}

func validateRailsSchema(ctx context.Context, db *sql.DB) error {
	for _, table := range []string{"users", "entities"} {
		var name string
		err := db.QueryRowContext(ctx,
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&name)
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("source is not a Minimal Clicker database: missing %s table", table)
		}
		if err != nil {
			return fmt.Errorf("inspect Rails database: %w", err)
		}
	}
	return nil
}

func normalizeImportedTime(value string) (string, error) {
	parsed, err := parseTime(value)
	if err != nil {
		return "", err
	}
	return formatTime(parsed), nil
}

func nullInt(value sql.NullInt64) int64 {
	if value.Valid && value.Int64 > 0 {
		return value.Int64
	}
	return 0
}
