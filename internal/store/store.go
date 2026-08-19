package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
)

type Store struct {
	db *sql.DB
}

type User struct {
	ID           int64
	Username     string
	Email        *string
	PasswordHash string
	Admin        bool
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type Counters struct {
	Exists        bool
	Clicks        int64
	DayStreak     int64
	MonthStreak   int64
	YearStreak    int64
	LastClickedAt *time.Time
}

const schemaVersion = 2

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
	id INTEGER PRIMARY KEY,
	username TEXT NOT NULL UNIQUE,
	email TEXT UNIQUE,
	password_hash TEXT NOT NULL,
	admin INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (
	user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	click_count INTEGER NOT NULL DEFAULT 0 CHECK (click_count >= 0),
	day_streak INTEGER NOT NULL DEFAULT 0 CHECK (day_streak >= 0),
	month_streak INTEGER NOT NULL DEFAULT 0 CHECK (month_streak >= 0),
	year_streak INTEGER NOT NULL DEFAULT 0 CHECK (year_streak >= 0),
	last_clicked_at TEXT
);
CREATE TABLE IF NOT EXISTS rails_entities (
	id INTEGER PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind TEXT,
	count INTEGER,
	created_time TEXT,
	modified_time TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rails_entities_user_id ON rails_entities(user_id);
CREATE TABLE IF NOT EXISTS sessions (
	token_hash BLOB PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
`

func Open(path string) (*Store, error) {
	if path == "" {
		return nil, errors.New("database path is required")
	}
	if path != ":memory:" {
		directory := filepath.Dir(path)
		if err := os.MkdirAll(directory, 0o700); err != nil {
			return nil, fmt.Errorf("create database directory: %w", err)
		}
		if directory != "." {
			if err := os.Chmod(directory, 0o700); err != nil {
				return nil, fmt.Errorf("secure database directory: %w", err)
			}
		}
		// SQLite's default creation mode is affected by the process umask and
		// can leave password and session digests readable by other local users.
		// Open the file ourselves so both new and existing databases are private.
		file, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
		if err != nil {
			return nil, fmt.Errorf("prepare database file: %w", err)
		}
		if err := file.Chmod(0o600); err != nil {
			file.Close()
			return nil, fmt.Errorf("secure database file: %w", err)
		}
		if err := file.Close(); err != nil {
			return nil, fmt.Errorf("close prepared database file: %w", err)
		}
	}

	// The store uses one persistent database/sql connection, so SQLite's plain
	// in-memory DSN is sufficient. A fixed shared-cache URI would make separate
	// Open(":memory:") calls unexpectedly share users and sessions.
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, "PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;"); err != nil {
		db.Close()
		return nil, fmt.Errorf("configure database: %w", err)
	}
	if _, err := db.ExecContext(ctx, schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("initialize database: %w", err)
	}
	var currentVersion int
	if err := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&currentVersion); err != nil {
		db.Close()
		return nil, fmt.Errorf("read schema version: %w", err)
	}
	if currentVersion > schemaVersion {
		db.Close()
		return nil, fmt.Errorf("database schema version %d is newer than supported version %d", currentVersion, schemaVersion)
	}
	if currentVersion < schemaVersion {
		if _, err := db.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", schemaVersion)); err != nil {
			db.Close()
			return nil, fmt.Errorf("upgrade schema version: %w", err)
		}
	}
	if path != ":memory:" {
		if err := secureSQLiteFiles(path); err != nil {
			db.Close()
			return nil, err
		}
	}
	return &Store{db: db}, nil
}

func secureSQLiteFiles(path string) error {
	for _, candidate := range []string{path, path + "-wal", path + "-shm", path + "-journal"} {
		if err := os.Chmod(candidate, 0o600); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("secure SQLite file %s: %w", candidate, err)
		}
	}
	return nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) Health(ctx context.Context) error {
	var value int
	if err := s.db.QueryRowContext(ctx, "SELECT 1").Scan(&value); err != nil {
		return fmt.Errorf("check database health: %w", err)
	}
	if value != 1 {
		return errors.New("database health check returned an unexpected value")
	}
	return nil
}

func (s *Store) CreateUser(ctx context.Context, username string, email *string, passwordHash string, now time.Time) (User, error) {
	result, err := s.db.ExecContext(ctx, `
		INSERT INTO users (username, email, password_hash, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)`,
		username, email, passwordHash, formatTime(now), formatTime(now))
	if isUniqueViolation(err) {
		return User{}, ErrConflict
	}
	if err != nil {
		return User{}, fmt.Errorf("create user: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return User{}, fmt.Errorf("read new user id: %w", err)
	}
	return s.UserByID(ctx, id)
}

func (s *Store) UserByIdentifier(ctx context.Context, identifier string) (User, error) {
	return scanUser(s.db.QueryRowContext(ctx, `
		SELECT id, username, email, password_hash, admin, created_at, updated_at
		FROM users WHERE username = ? OR email = ? LIMIT 1`, identifier, identifier))
}

func (s *Store) UserByID(ctx context.Context, id int64) (User, error) {
	return scanUser(s.db.QueryRowContext(ctx, `
		SELECT id, username, email, password_hash, admin, created_at, updated_at
		FROM users WHERE id = ?`, id))
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanUser(row rowScanner) (User, error) {
	var (
		user                 User
		email                sql.NullString
		admin                int
		createdAt, updatedAt string
	)
	err := row.Scan(&user.ID, &user.Username, &email, &user.PasswordHash, &admin, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("read user: %w", err)
	}
	if email.Valid {
		user.Email = &email.String
	}
	user.Admin = admin != 0
	user.CreatedAt, err = parseTime(createdAt)
	if err != nil {
		return User{}, fmt.Errorf("parse user created_at: %w", err)
	}
	user.UpdatedAt, err = parseTime(updatedAt)
	if err != nil {
		return User{}, fmt.Errorf("parse user updated_at: %w", err)
	}
	return user, nil
}

func (s *Store) CreateSession(ctx context.Context, rawToken []byte, userID int64, expiresAt, now time.Time) error {
	hash := sha256.Sum256(rawToken)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
		VALUES (?, ?, ?, ?)`, hash[:], userID, expiresAt.Unix(), now.Unix())
	if err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	return nil
}

func (s *Store) UserBySession(ctx context.Context, rawToken []byte, now time.Time) (User, error) {
	hash := sha256.Sum256(rawToken)
	return scanUser(s.db.QueryRowContext(ctx, `
		SELECT u.id, u.username, u.email, u.password_hash, u.admin, u.created_at, u.updated_at
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ? AND s.expires_at > ?`, hash[:], now.Unix()))
}

func (s *Store) DeleteSession(ctx context.Context, rawToken []byte) error {
	hash := sha256.Sum256(rawToken)
	if _, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, hash[:]); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

func (s *Store) DeleteExpiredSessions(ctx context.Context, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at <= ?`, now.Unix())
	if err != nil {
		return fmt.Errorf("delete expired sessions: %w", err)
	}
	return nil
}

func (s *Store) CurrentCounters(ctx context.Context, userID int64) (Counters, error) {
	var counters Counters
	var last sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT click_count, day_streak, month_streak, year_streak, last_clicked_at
		FROM counters WHERE user_id = ?`, userID).
		Scan(&counters.Clicks, &counters.DayStreak, &counters.MonthStreak, &counters.YearStreak, &last)
	if errors.Is(err, sql.ErrNoRows) {
		return Counters{}, nil
	}
	if err != nil {
		return Counters{}, fmt.Errorf("read counters: %w", err)
	}
	counters.Exists = true
	if last.Valid {
		parsed, err := parseTime(last.String)
		if err != nil {
			return Counters{}, fmt.Errorf("parse last click: %w", err)
		}
		counters.LastClickedAt = &parsed
	}
	return counters, nil
}

func (s *Store) Increment(ctx context.Context, userID int64, now time.Time) (Counters, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Counters{}, fmt.Errorf("begin click: %w", err)
	}
	defer tx.Rollback()

	var counters Counters
	var last sql.NullString
	err = tx.QueryRowContext(ctx, `
		SELECT click_count, day_streak, month_streak, year_streak, last_clicked_at
		FROM counters WHERE user_id = ?`, userID).
		Scan(&counters.Clicks, &counters.DayStreak, &counters.MonthStreak, &counters.YearStreak, &last)
	if errors.Is(err, sql.ErrNoRows) {
		counters.Exists = true
		counters.DayStreak = 1
		counters.MonthStreak = 1
		counters.YearStreak = 1
	} else if err != nil {
		return Counters{}, fmt.Errorf("read click counters: %w", err)
	} else if last.Valid {
		previous, err := parseTime(last.String)
		if err != nil {
			return Counters{}, fmt.Errorf("parse previous click: %w", err)
		}
		counters.DayStreak = updateStreak(counters.DayStreak, dateKey(previous), dateKey(now), dateKey(now.AddDate(0, 0, -1)))
		counters.MonthStreak = updateStreak(counters.MonthStreak, monthKey(previous), monthKey(now), previousMonthKey(now))
		counters.YearStreak = updateStreak(counters.YearStreak, yearKey(previous), yearKey(now), yearKey(now.AddDate(-1, 0, 0)))
	} else {
		// Imported or manually repaired rows without a click timestamp have no
		// period to compare against. Start a fresh streak on the next click.
		counters.DayStreak = 1
		counters.MonthStreak = 1
		counters.YearStreak = 1
	}
	counters.Clicks++
	now = now.UTC()
	counters.LastClickedAt = &now

	_, err = tx.ExecContext(ctx, `
		INSERT INTO counters (user_id, click_count, day_streak, month_streak, year_streak, last_clicked_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			click_count = excluded.click_count,
			day_streak = excluded.day_streak,
			month_streak = excluded.month_streak,
			year_streak = excluded.year_streak,
			last_clicked_at = excluded.last_clicked_at`,
		userID, counters.Clicks, counters.DayStreak, counters.MonthStreak, counters.YearStreak, formatTime(now))
	if err != nil {
		return Counters{}, fmt.Errorf("save click: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Counters{}, fmt.Errorf("commit click: %w", err)
	}
	return counters, nil
}

func updateStreak(count int64, previous, current, immediatelyPrevious string) int64 {
	switch previous {
	case immediatelyPrevious:
		return count + 1
	case current:
		return count
	default:
		return 1
	}
}

func dateKey(t time.Time) string  { return t.UTC().Format("2006-01-02") }
func monthKey(t time.Time) string { return t.UTC().Format("2006-01") }
func yearKey(t time.Time) string  { return t.UTC().Format("2006") }

func previousMonthKey(t time.Time) string {
	t = t.UTC()
	currentMonth := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
	return monthKey(currentMonth.AddDate(0, -1, 0))
}

func formatTime(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func parseTime(value string) (time.Time, error) {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05.999999", "2006-01-02 15:04:05"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("unsupported timestamp %q", value)
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "unique constraint")
}
