package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

var (
	ErrNotFound           = errors.New("not found")
	ErrConflict           = errors.New("conflict")
	ErrCredentialsChanged = errors.New("account changed during sign-in")
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

const schemaVersion = 5

type schemaTable struct {
	name    string
	columns []string
}

var (
	coreSchemaTables = []schemaTable{
		{"users", []string{"id", "username", "email", "password_hash", "admin", "created_at", "updated_at"}},
		{"counters", []string{"user_id", "click_count", "day_streak", "month_streak", "year_streak", "last_clicked_at"}},
		{"sessions", []string{"token_hash", "user_id", "expires_at", "created_at"}},
	}
	archiveSchemaTable = schemaTable{
		"rails_entities",
		[]string{"id", "user_id", "kind", "count", "created_time", "modified_time", "created_at", "updated_at"},
	}
)

const schema = `
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
CREATE TABLE IF NOT EXISTS rails_json_users (
	user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	payload TEXT NOT NULL CHECK (json_valid(payload))
);
CREATE TABLE IF NOT EXISTS sessions (
	token_hash BLOB PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS player_activity (
	id INTEGER PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	action TEXT NOT NULL CHECK (action IN ('signup', 'sign_in', 'click')),
	occurred_at TEXT NOT NULL,
	click_count INTEGER
);
CREATE INDEX IF NOT EXISTS player_activity_user_time ON player_activity(user_id, id DESC);
CREATE INDEX IF NOT EXISTS player_activity_time ON player_activity(occurred_at);
CREATE INDEX IF NOT EXISTS player_activity_sign_in ON player_activity(user_id, occurred_at DESC) WHERE action='sign_in';
CREATE TABLE IF NOT EXISTS admin_audit (
	id INTEGER PRIMARY KEY,
	actor_id INTEGER,
	actor_username TEXT NOT NULL,
	action TEXT NOT NULL,
	target_user_id INTEGER,
	result TEXT NOT NULL,
	details TEXT NOT NULL,
	occurred_at TEXT NOT NULL
);
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
		// SQLite's default creation mode is affected by the process umask and
		// can leave password and session digests readable by other local users.
		// Open the file ourselves so both new and existing databases are private.
		file, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
		if err != nil {
			return nil, fmt.Errorf("prepare database file: %w", err)
		}
		info, err := file.Stat()
		if err != nil {
			file.Close()
			return nil, fmt.Errorf("inspect database file: %w", err)
		}
		if !info.Mode().IsRegular() {
			file.Close()
			return nil, fmt.Errorf("database must be a regular file: %s", path)
		}
		if err := file.Chmod(0o600); err != nil {
			file.Close()
			return nil, fmt.Errorf("secure database file: %w", err)
		}
		if err := file.Close(); err != nil {
			return nil, fmt.Errorf("close prepared database file: %w", err)
		}
	}

	// Configure every connection, including replacements after cancellation or
	// driver errors. Exec-only PRAGMAs would disappear when sql.DB reconnects.
	// Encode disk paths as literal filenames, never caller-supplied SQLite URIs.
	dsn := ":memory:"
	if path != ":memory:" {
		absolute, err := filepath.Abs(path)
		if err != nil {
			return nil, fmt.Errorf("resolve database path: %w", err)
		}
		dsn = (&url.URL{Scheme: "file", Path: filepath.ToSlash(absolute)}).String()
	}
	settings := url.Values{}
	settings.Add("_pragma", "foreign_keys(1)")
	settings.Add("_pragma", "busy_timeout(5000)")
	db, err := sql.Open("sqlite", dsn+"?"+settings.Encode())
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	currentVersion, err := existingSchemaVersion(ctx, db)
	if err != nil {
		db.Close()
		return nil, err
	}
	if currentVersion > schemaVersion {
		db.Close()
		return nil, fmt.Errorf("database schema version %d is newer than supported version %d", currentVersion, schemaVersion)
	}
	if err := validateExistingSchema(ctx, db, currentVersion); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.ExecContext(ctx, "PRAGMA journal_mode = WAL"); err != nil {
		db.Close()
		return nil, fmt.Errorf("configure database: %w", err)
	}
	if err := initializeSchema(ctx, db, currentVersion); err != nil {
		db.Close()
		return nil, err
	}
	if path != ":memory:" {
		if err := secureSQLiteFiles(path); err != nil {
			db.Close()
			return nil, err
		}
	}
	return &Store{db: db}, nil
}

func initializeSchema(ctx context.Context, db *sql.DB, currentVersion int) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin schema upgrade: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, schema); err != nil {
		return fmt.Errorf("initialize database: %w", err)
	}
	if err := validateSchemaTables(ctx, tx, allSchemaTables()); err != nil {
		return fmt.Errorf("validate initialized database: %w", err)
	}
	if currentVersion < schemaVersion {
		if _, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", schemaVersion)); err != nil {
			return fmt.Errorf("upgrade schema version: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit schema upgrade: %w", err)
	}
	return nil
}

func existingSchemaVersion(ctx context.Context, db *sql.DB) (int, error) {
	var version int
	if err := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return 0, fmt.Errorf("read schema version: %w", err)
	}
	return version, nil
}

func validateExistingSchema(ctx context.Context, db *sql.DB, version int) error {
	var objectCount int
	if err := db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM sqlite_schema
		WHERE name NOT LIKE 'sqlite_%'`).Scan(&objectCount); err != nil {
		return fmt.Errorf("inspect database schema: %w", err)
	}
	if objectCount == 0 {
		if version != 0 {
			return fmt.Errorf("database schema version %d has no Go Click tables", version)
		}
		return nil
	}

	tables := coreSchemaTables
	if version >= 2 {
		tables = append(tables, archiveSchemaTable)
	}
	if version >= 3 {
		tables = allSchemaTables()
		if version < 4 {
			tables = tables[:len(tables)-1]
		}
	}
	if err := validateSchemaTables(ctx, db, tables); err != nil {
		return fmt.Errorf("database is not a compatible Go Click database: %w", err)
	}
	return nil
}

type schemaQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func validateSchemaTables(ctx context.Context, db schemaQueryer, tables []schemaTable) error {
	for _, table := range tables {
		var objectType string
		err := db.QueryRowContext(ctx, `
			SELECT type FROM sqlite_schema WHERE name = ?`, table.name).Scan(&objectType)
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("missing %s table", table.name)
		}
		if err != nil {
			return fmt.Errorf("inspect %s table: %w", table.name, err)
		}
		if objectType != "table" {
			return fmt.Errorf("%s is a %s, not a table", table.name, objectType)
		}

		present := make(map[string]bool)
		rows, err := db.QueryContext(ctx, `PRAGMA table_info(`+table.name+`)`)
		if err != nil {
			return fmt.Errorf("inspect %s columns: %w", table.name, err)
		}
		for rows.Next() {
			var cid, notNull, primaryKey int
			var name, columnType string
			var defaultValue sql.NullString
			if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
				rows.Close()
				return fmt.Errorf("inspect %s columns: %w", table.name, err)
			}
			present[name] = true
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return fmt.Errorf("inspect %s columns: %w", table.name, err)
		}
		if err := rows.Close(); err != nil {
			return fmt.Errorf("close %s schema inspection: %w", table.name, err)
		}
		for _, column := range table.columns {
			if !present[column] {
				return fmt.Errorf("missing %s.%s", table.name, column)
			}
		}
	}
	return nil
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
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `
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
	if _, err := tx.ExecContext(ctx, `INSERT INTO player_activity(user_id,action,occurred_at) VALUES (?, 'signup', ?)`, id, formatTime(now)); err != nil {
		return User{}, err
	}
	if err := tx.Commit(); err != nil {
		return User{}, err
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

func scanUser(row rowScanner, extra ...any) (User, error) {
	var (
		user                 User
		email                sql.NullString
		admin                int
		createdAt, updatedAt string
	)
	destinations := []any{&user.ID, &user.Username, &email, &user.PasswordHash, &admin, &createdAt, &updatedAt}
	err := row.Scan(append(destinations, extra...)...)
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
	return s.replaceSession(ctx, rawToken, nil, userID, expiresAt, now, nil)
}

// ReplaceSession creates a session and revokes the previous token atomically.
// The verified account must still have the same credentials and role. This
// prevents an in-flight password check from creating a session after an
// operator resets the password or revokes access. Failed replacements preserve
// the previous session.
func (s *Store) ReplaceSession(ctx context.Context, rawToken, previousToken []byte, verified User, expiresAt, now time.Time) error {
	return s.replaceSession(ctx, rawToken, previousToken, verified.ID, expiresAt, now, &verified)
}

func (s *Store) replaceSession(ctx context.Context, rawToken, previousToken []byte, userID int64, expiresAt, now time.Time, verified *User) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin session replacement: %w", err)
	}
	defer tx.Rollback()
	if verified != nil {
		current, err := scanUser(tx.QueryRowContext(ctx, `SELECT id,username,email,password_hash,admin,created_at,updated_at FROM users WHERE id=?`, userID))
		if errors.Is(err, ErrNotFound) {
			return ErrCredentialsChanged
		}
		if err != nil {
			return fmt.Errorf("verify session account: %w", err)
		}
		if current.PasswordHash != verified.PasswordHash || current.Admin != verified.Admin || !current.UpdatedAt.Equal(verified.UpdatedAt) {
			return ErrCredentialsChanged
		}
	}
	hash := sha256.Sum256(rawToken)
	_, err = tx.ExecContext(ctx, `
		INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
		VALUES (?, ?, ?, ?)`, hash[:], userID, expiresAt.Unix(), now.Unix())
	if err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	if len(previousToken) > 0 {
		previousHash := sha256.Sum256(previousToken)
		if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, previousHash[:]); err != nil {
			return fmt.Errorf("revoke previous session: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO player_activity(user_id,action,occurred_at) VALUES (?, 'sign_in', ?)`, userID, formatTime(now)); err != nil {
		return fmt.Errorf("record sign in: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit session replacement: %w", err)
	}
	return nil
}

func (s *Store) UserBySession(ctx context.Context, rawToken []byte, now time.Time) (User, error) {
	session, err := s.readSession(ctx, rawToken, now)
	return session.User, err
}

type Session struct {
	User      User
	ExpiresAt time.Time
	Renewed   bool
}

func (s *Store) readSession(ctx context.Context, rawToken []byte, now time.Time) (Session, error) {
	hash := sha256.Sum256(rawToken)
	var expires int64
	user, err := scanUser(s.db.QueryRowContext(ctx, `
		SELECT u.id, u.username, u.email, u.password_hash, u.admin, u.created_at, u.updated_at, s.expires_at
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ? AND s.expires_at > ?`, hash[:], now.Unix()), &expires)
	if err != nil {
		return Session{}, err
	}
	return Session{User: user, ExpiresAt: time.Unix(expires, 0).UTC()}, nil
}

// UseSession authenticates and periodically extends a live session's inactivity
// deadline. Renewal preserves the token and original sign-in time, so parallel
// clicks and other tabs remain valid. It never recreates a revoked/expired row.
func (s *Store) UseSession(ctx context.Context, rawToken []byte, now time.Time, lifetime time.Duration) (Session, error) {
	if lifetime < time.Second {
		return Session{}, errors.New("session lifetime must be at least one second")
	}
	session, err := s.readSession(ctx, rawToken, now)
	if err != nil {
		return Session{}, err
	}
	expires := now.Add(lifetime)
	// Ordinary gameplay stays read-only for authentication most of the time.
	// Renew at daily intervals, or half a shorter configured lifetime.
	interval := min(24*time.Hour, lifetime/2)
	if session.ExpiresAt.After(expires.Add(-interval)) {
		return session, nil
	}
	hash := sha256.Sum256(rawToken)
	var renewedExpiry int64
	err = s.db.QueryRowContext(ctx, `UPDATE sessions SET expires_at=MAX(expires_at,?)
		WHERE token_hash=? AND expires_at>? RETURNING expires_at`, expires.Unix(), hash[:], now.Unix()).Scan(&renewedExpiry)
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	if err != nil {
		return Session{}, fmt.Errorf("renew session: %w", err)
	}
	session.ExpiresAt = time.Unix(renewedExpiry, 0).UTC()
	session.Renewed = true
	return session, nil
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
	now = now.UTC()
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
	counters.Exists = true
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
	if _, err := tx.ExecContext(ctx, `INSERT INTO player_activity(user_id,action,occurred_at,click_count) VALUES (?, 'click', ?, ?)`, userID, formatTime(now), counters.Clicks); err != nil {
		return Counters{}, fmt.Errorf("record click activity: %w", err)
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
	var sqliteErr *sqlite.Error
	return errors.As(err, &sqliteErr) &&
		(sqliteErr.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE || sqliteErr.Code() == sqlite3.SQLITE_CONSTRAINT_PRIMARYKEY)
}
