package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const maxImportedBcryptCost = 14

type ImportResult struct {
	Users    int `json:"users"`
	Counters int `json:"counters"`
	Entities int `json:"entities"`
}

type ImportAudit struct {
	Actor User
	Now   time.Time
	// HTTP recovery must still be authorized when the import transaction starts.
	RequireCurrentActor bool
}

func verifyRecoveryActor(ctx context.Context, tx *sql.Tx, actor User) error {
	current, err := scanUser(tx.QueryRowContext(ctx, `SELECT id,username,email,password_hash,admin,created_at,updated_at FROM users WHERE id=?`, actor.ID))
	if errors.Is(err, ErrNotFound) {
		return ErrCredentialsChanged
	}
	if err != nil {
		return err
	}
	if !actor.Admin || !current.Admin || current.PasswordHash != actor.PasswordHash || !current.UpdatedAt.Equal(actor.UpdatedAt) {
		return ErrCredentialsChanged
	}
	return nil
}

func recordImportAudit(ctx context.Context, tx *sql.Tx, format string, result ImportResult, audit []ImportAudit) error {
	actor, now := User{Username: "operator"}, time.Now()
	if len(audit) > 0 {
		actor, now = audit[0].Actor, audit[0].Now
	}
	var actorID any
	if actor.ID > 0 {
		actorID = actor.ID
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO admin_audit(actor_id,actor_username,action,result,details,occurred_at) VALUES (?,?,'rails_import','success',?,?)`, actorID, actor.Username, fmt.Sprintf("%s: %d users, %d entities, %d counter sets", format, result.Users, result.Entities, result.Counters), formatTime(now))
	return err
}

type railsEntity struct {
	ID           int64
	UserID       int64
	Kind         *string
	Count        *int64
	CreatedTime  *string
	ModifiedTime *string
	CreatedAt    string
	UpdatedAt    string
}

type canonicalCounters struct {
	clicks, day, month, year int64
	lastClicked              *string
	seen                     map[string]bool
}

type archiveIdentity struct {
	userID int64
	source string
}

func archiveIdentities(ctx context.Context, tx *sql.Tx) (map[int64]archiveIdentity, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id,user_id,source FROM (`+entityArchiveQuery+`)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	identities := make(map[int64]archiveIdentity)
	for rows.Next() {
		var id int64
		var identity archiveIdentity
		if err := rows.Scan(&id, &identity.userID, &identity.source); err != nil {
			return nil, err
		}
		if _, exists := identities[id]; exists {
			return nil, fmt.Errorf("%w: target has conflicting archived entity ID %d", ErrConflict, id)
		}
		identities[id] = identity
	}
	return identities, rows.Err()
}

// ImportRails copies the Minimal Clicker primary SQLite database. Password
// digests are copied verbatim because Rails and Go use the same bcrypt format.
// Every source entity is retained in rails_entities; counters is the normalized
// gameplay projection used by the Go API.
func (s *Store) ImportRails(ctx context.Context, sourcePath string, audit ...ImportAudit) (ImportResult, error) {
	if sourcePath == "" {
		return ImportResult{}, errors.New("rails database source path is required")
	}
	absolute, err := filepath.Abs(sourcePath)
	if err != nil {
		return ImportResult{}, fmt.Errorf("resolve source path: %w", err)
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return ImportResult{}, fmt.Errorf("inspect rails database: %w", err)
	}
	if !info.Mode().IsRegular() {
		return ImportResult{}, errors.New("rails database source is not a regular file")
	}
	sourceURL := &url.URL{Scheme: "file", Path: filepath.ToSlash(absolute)}
	query := sourceURL.Query()
	query.Set("mode", "ro")
	sourceURL.RawQuery = query.Encode()
	source, err := sql.Open("sqlite", sourceURL.String())
	if err != nil {
		return ImportResult{}, fmt.Errorf("open rails database: %w", err)
	}
	defer source.Close()
	source.SetMaxOpenConns(1)

	// Keep schema validation, users, and entities on one read transaction. This
	// gives a consistent snapshot even if a source database is copied from a
	// running application that continues to receive writes.
	sourceTx, err := source.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return ImportResult{}, fmt.Errorf("begin rails database snapshot: %w", err)
	}
	defer sourceTx.Rollback()

	if err := validateRailsSchema(ctx, sourceTx); err != nil {
		return ImportResult{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ImportResult{}, fmt.Errorf("begin import: %w", err)
	}
	defer tx.Rollback()
	if len(audit) > 0 && audit[0].RequireCurrentActor {
		if err := verifyRecoveryActor(ctx, tx, audit[0].Actor); err != nil {
			return ImportResult{}, err
		}
	}

	userIDs, result, err := importRailsUsers(ctx, sourceTx, tx)
	if err != nil {
		return ImportResult{}, err
	}
	archivedIDs, err := archiveIdentities(ctx, tx)
	if err != nil {
		return ImportResult{}, err
	}

	entities, err := sourceTx.QueryContext(ctx, `
		SELECT id, user_id, kind, count, created_time, modified_time, created_at, updated_at
		FROM entities ORDER BY id`)
	if err != nil {
		return ImportResult{}, fmt.Errorf("read rails entities: %w", err)
	}
	defer entities.Close()

	canonical := make(map[int64]*canonicalCounters)
	entityIDs := make(map[int64]bool)
	for entities.Next() {
		entity, err := scanRailsEntity(entities)
		if err != nil {
			return ImportResult{}, fmt.Errorf("scan rails entity: %w", err)
		}
		if !userIDs[entity.UserID] {
			return ImportResult{}, fmt.Errorf("rails entity %d references missing user %d", entity.ID, entity.UserID)
		}
		if entity.ID <= 0 || entityIDs[entity.ID] {
			return ImportResult{}, fmt.Errorf("invalid or duplicate rails entity ID %d", entity.ID)
		}
		entityIDs[entity.ID] = true
		if archivedIDs[entity.ID].source == "json" {
			return ImportResult{}, fmt.Errorf("%w: entity ID %d already belongs to a partial JSON archive; use a fresh target for a full SQLite migration", ErrConflict, entity.ID)
		}
		if err := insertRailsEntity(ctx, tx, entity); err != nil {
			return ImportResult{}, fmt.Errorf("import rails entity %d: %w", entity.ID, err)
		}
		result.Entities++

		if entity.Kind == nil {
			continue
		}
		switch *entity.Kind {
		case "click_count", "streak_counter_day", "streak_counter_month", "streak_counter_year":
			if entity.Count != nil && *entity.Count < 0 {
				return ImportResult{}, fmt.Errorf("rails entity %d (%s) has a negative count", entity.ID, *entity.Kind)
			}
			state := canonical[entity.UserID]
			if state == nil {
				state = &canonicalCounters{seen: make(map[string]bool)}
				canonical[entity.UserID] = state
			}
			if state.seen[*entity.Kind] {
				return ImportResult{}, fmt.Errorf("rails user %d has duplicate %s entities", entity.UserID, *entity.Kind)
			}
			state.seen[*entity.Kind] = true
			count := int64(0)
			if entity.Count != nil {
				count = *entity.Count
			}
			switch *entity.Kind {
			case "click_count":
				state.clicks = count
				if entity.ModifiedTime != nil {
					state.lastClicked = entity.ModifiedTime
				} else {
					state.lastClicked = &entity.UpdatedAt
				}
			case "streak_counter_day":
				state.day = count
			case "streak_counter_month":
				state.month = count
			case "streak_counter_year":
				state.year = count
			}
		}
	}
	if err := entities.Err(); err != nil {
		return ImportResult{}, fmt.Errorf("iterate rails entities: %w", err)
	}
	for userID := range userIDs {
		if canonical[userID] != nil {
			continue
		}
		var existing int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM counters WHERE user_id=?`, userID).Scan(&existing); err != nil {
			return ImportResult{}, err
		}
		if existing != 0 {
			return ImportResult{}, fmt.Errorf("%w: target counter set for user %d differs from the empty source; refusing to overwrite existing data", ErrConflict, userID)
		}
	}

	userIDsWithCounters := make([]int64, 0, len(canonical))
	for userID := range canonical {
		userIDsWithCounters = append(userIDsWithCounters, userID)
	}
	slices.Sort(userIDsWithCounters)
	for _, userID := range userIDsWithCounters {
		if err := insertCounters(ctx, tx, userID, canonical[userID]); err != nil {
			return ImportResult{}, err
		}
		result.Counters++
	}

	if err := recordImportAudit(ctx, tx, "sqlite", result, audit); err != nil {
		return ImportResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ImportResult{}, fmt.Errorf("commit rails import: %w", err)
	}
	return result, nil
}

type railsQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func importRailsUsers(ctx context.Context, source railsQueryer, tx *sql.Tx) (map[int64]bool, ImportResult, error) {
	rows, err := source.QueryContext(ctx, `
		SELECT id, username, email, password_digest, admin, created_at, updated_at
		FROM users ORDER BY id`)
	if err != nil {
		return nil, ImportResult{}, fmt.Errorf("read rails users: %w", err)
	}
	defer rows.Close()

	userIDs := make(map[int64]bool)
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
			return nil, ImportResult{}, fmt.Errorf("scan rails user: %w", err)
		}
		if id <= 0 || username == "" || userIDs[id] {
			return nil, ImportResult{}, errors.New("rails database has invalid or duplicate user records")
		}
		if !passwordHash.Valid || passwordHash.String == "" {
			return nil, ImportResult{}, fmt.Errorf("rails user %d (%s) has no password digest", id, username)
		}
		cost, err := bcrypt.Cost([]byte(passwordHash.String))
		if err != nil {
			return nil, ImportResult{}, fmt.Errorf("rails user %d (%s) has an invalid bcrypt password digest: %w", id, username, err)
		}
		if !backupHashPattern.MatchString(passwordHash.String) {
			return nil, ImportResult{}, fmt.Errorf("rails user %d (%s) has an invalid bcrypt password digest", id, username)
		}
		if cost < bcrypt.DefaultCost || cost > maxImportedBcryptCost {
			return nil, ImportResult{}, fmt.Errorf(
				"rails user %d (%s) has unsupported bcrypt cost %d (allowed %d-%d)",
				id, username, cost, bcrypt.DefaultCost, maxImportedBcryptCost)
		}
		createdAt, err = normalizeImportedTime(createdAt)
		if err != nil {
			return nil, ImportResult{}, fmt.Errorf("rails user %d (%s) has invalid created_at: %w", id, username, err)
		}
		updatedAt, err = normalizeImportedTime(updatedAt)
		if err != nil {
			return nil, ImportResult{}, fmt.Errorf("rails user %d (%s) has invalid updated_at: %w", id, username, err)
		}
		var emailValue *string
		if email.Valid && email.String != "" {
			emailValue = &email.String
		}
		if err := ensureImportedUser(ctx, tx, id, username, emailValue, passwordHash.String, admin, createdAt, updatedAt); err != nil {
			return nil, ImportResult{}, fmt.Errorf("import rails user %d (%s): %w", id, username, err)
		}
		userIDs[id] = true
		result.Users++
	}
	if err := rows.Err(); err != nil {
		return nil, ImportResult{}, fmt.Errorf("iterate rails users: %w", err)
	}
	return userIDs, result, nil
}

func ensureImportedUser(
	ctx context.Context,
	tx *sql.Tx,
	id int64,
	username string,
	email *string,
	passwordHash string,
	admin bool,
	createdAt string,
	updatedAt string,
) error {
	existing, err := scanUser(tx.QueryRowContext(ctx, `
		SELECT id, username, email, password_hash, admin, created_at, updated_at
		FROM users WHERE id = ?`, id))
	if err == nil {
		if sameImportedUser(existing, id, username, email, passwordHash, admin, createdAt, updatedAt) {
			return nil
		}
		return fmt.Errorf("%w: target user ID %d differs; refusing to overwrite existing data", ErrConflict, id)
	}
	if !errors.Is(err, ErrNotFound) {
		return err
	}

	var conflictingID int64
	err = tx.QueryRowContext(ctx, `
		SELECT id FROM users
		WHERE username = ? OR (? IS NOT NULL AND email = ?)
		LIMIT 1`, username, email, email).Scan(&conflictingID)
	if err == nil {
		return fmt.Errorf("%w: target user %d already uses username or email", ErrConflict, conflictingID)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("check target user uniqueness: %w", err)
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO users (id, username, email, password_hash, admin, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, id, username, email, passwordHash, admin, createdAt, updatedAt)
	return err
}

func sameImportedUser(existing User, id int64, username string, email *string, passwordHash string, admin bool, createdAt, updatedAt string) bool {
	return existing.ID == id && existing.Username == username && sameString(existing.Email, email) &&
		existing.PasswordHash == passwordHash && existing.Admin == admin &&
		formatTime(existing.CreatedAt) == createdAt && formatTime(existing.UpdatedAt) == updatedAt
}

func sameString(first, second *string) bool {
	if first == nil || second == nil {
		return first == nil && second == nil
	}
	return *first == *second
}

func scanRailsEntity(row interface{ Scan(...any) error }) (railsEntity, error) {
	var (
		entity                          railsEntity
		kind, createdTime, modifiedTime sql.NullString
		countValue                      sql.NullInt64
		createdAt, updatedAt            sql.NullString
		err                             error
	)
	if err := row.Scan(&entity.ID, &entity.UserID, &kind, &countValue, &createdTime, &modifiedTime, &createdAt, &updatedAt); err != nil {
		return railsEntity{}, err
	}
	if !createdAt.Valid || !updatedAt.Valid {
		return railsEntity{}, errors.New("entity has no created_at or updated_at")
	}
	entity.CreatedAt, err = normalizeImportedTime(createdAt.String)
	if err != nil {
		return railsEntity{}, fmt.Errorf("invalid created_at: %w", err)
	}
	entity.UpdatedAt, err = normalizeImportedTime(updatedAt.String)
	if err != nil {
		return railsEntity{}, fmt.Errorf("invalid updated_at: %w", err)
	}
	if kind.Valid {
		entity.Kind = &kind.String
	}
	if countValue.Valid {
		entity.Count = &countValue.Int64
	}
	if createdTime.Valid {
		normalized, err := normalizeImportedTime(createdTime.String)
		if err != nil {
			return railsEntity{}, fmt.Errorf("invalid created_time: %w", err)
		}
		entity.CreatedTime = &normalized
	}
	if modifiedTime.Valid {
		normalized, err := normalizeImportedTime(modifiedTime.String)
		if err != nil {
			return railsEntity{}, fmt.Errorf("invalid modified_time: %w", err)
		}
		entity.ModifiedTime = &normalized
	}
	return entity, nil
}

func insertRailsEntity(ctx context.Context, tx *sql.Tx, entity railsEntity) error {
	existing, err := scanRailsEntity(tx.QueryRowContext(ctx, `
		SELECT id, user_id, kind, count, created_time, modified_time, created_at, updated_at
		FROM rails_entities WHERE id = ?`, entity.ID))
	if err == nil {
		if sameRailsEntity(existing, entity) {
			return nil
		}
		return fmt.Errorf("%w: target entity ID %d differs; refusing to overwrite existing data", ErrConflict, entity.ID)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO rails_entities
			(id, user_id, kind, count, created_time, modified_time, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, entity.ID, entity.UserID, entity.Kind, entity.Count,
		entity.CreatedTime, entity.ModifiedTime, entity.CreatedAt, entity.UpdatedAt)
	return err
}

func sameRailsEntity(first, second railsEntity) bool {
	return first.ID == second.ID && first.UserID == second.UserID &&
		sameString(first.Kind, second.Kind) && sameInt(first.Count, second.Count) &&
		sameString(first.CreatedTime, second.CreatedTime) && sameString(first.ModifiedTime, second.ModifiedTime) &&
		first.CreatedAt == second.CreatedAt && first.UpdatedAt == second.UpdatedAt
}

func sameInt(first, second *int64) bool {
	if first == nil || second == nil {
		return first == nil && second == nil
	}
	return *first == *second
}

func insertCounters(ctx context.Context, tx *sql.Tx, userID int64, values *canonicalCounters) error {
	var (
		clicks, day, month, year int64
		lastClicked              sql.NullString
	)
	err := tx.QueryRowContext(ctx, `
		SELECT click_count, day_streak, month_streak, year_streak, last_clicked_at
		FROM counters WHERE user_id = ?`, userID).
		Scan(&clicks, &day, &month, &year, &lastClicked)
	if err == nil {
		if clicks == values.clicks && day == values.day && month == values.month && year == values.year &&
			((values.lastClicked == nil && !lastClicked.Valid) ||
				(values.lastClicked != nil && lastClicked.Valid && *values.lastClicked == lastClicked.String)) {
			return nil
		}
		return fmt.Errorf("%w: target counters for user %d differ; refusing to overwrite existing data", ErrConflict, userID)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("check target counters for user %d: %w", userID, err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO counters (user_id, click_count, day_streak, month_streak, year_streak, last_clicked_at)
		VALUES (?, ?, ?, ?, ?, ?)`, userID, values.clicks, values.day, values.month, values.year, values.lastClicked)
	if err != nil {
		return fmt.Errorf("import rails counters for user %d: %w", userID, err)
	}
	return nil
}

func validateRailsSchema(ctx context.Context, db railsQueryer) error {
	required := map[string][]string{
		"users":    {"id", "username", "email", "password_digest", "admin", "created_at", "updated_at"},
		"entities": {"id", "user_id", "kind", "count", "created_time", "modified_time", "created_at", "updated_at"},
	}
	for table, columns := range required {
		present := make(map[string]bool)
		rows, err := db.QueryContext(ctx, `PRAGMA table_info(`+table+`)`)
		if err != nil {
			return fmt.Errorf("inspect rails %s table: %w", table, err)
		}
		for rows.Next() {
			var cid, notNull, primaryKey int
			var name, columnType string
			var defaultValue sql.NullString
			if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
				rows.Close()
				return fmt.Errorf("inspect rails %s columns: %w", table, err)
			}
			present[name] = true
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return fmt.Errorf("inspect rails %s columns: %w", table, err)
		}
		rows.Close()
		for _, column := range columns {
			if !present[column] {
				return fmt.Errorf("source is not a Minimal Clicker database: missing %s.%s", table, column)
			}
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
