package store

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"slices"

	"golang.org/x/crypto/bcrypt"
)

const MaxRailsJSONBytes = 16 << 20

type railsJSONUser struct {
	ID        int64           `json:"id"`
	Username  string          `json:"username"`
	Email     *string         `json:"email"`
	Admin     *bool           `json:"admin"`
	CreatedAt string          `json:"created_at"`
	UpdatedAt string          `json:"updated_at"`
	Entities  json.RawMessage `json:"entities"`
}

type railsJSONEntity struct {
	ID           int64   `json:"id"`
	Kind         *string `json:"kind"`
	Count        *int64  `json:"count"`
	CreatedTime  *string `json:"created_time"`
	ModifiedTime *string `json:"modified_time"`
}

func decodeRailsJSON(data []byte, into any) error {
	if err := uniqueJSONKeys(json.NewDecoder(bytes.NewReader(data)), 0); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(into); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return errors.New("expected exactly one JSON value")
	}
	return nil
}

func uniqueJSONKeys(decoder *json.Decoder, depth int) error {
	if depth > 64 {
		return errors.New("JSON nesting exceeds 64 levels")
	}
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	seen := make(map[string]bool)
	for decoder.More() {
		if delimiter == '{' {
			key, err := decoder.Token()
			if err != nil {
				return err
			}
			name, ok := key.(string)
			if !ok || seen[name] {
				return errors.New("duplicate or invalid JSON object key")
			}
			seen[name] = true
		}
		if err := uniqueJSONKeys(decoder, depth+1); err != nil {
			return err
		}
	}
	_, err = decoder.Token()
	return err
}

// canonicalJSON sorts object keys without changing numbers or collapsing
// missing fields into null. It makes formatting-only changes idempotent.
func canonicalJSON(data []byte) (string, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return "", err
	}
	out, err := json.Marshal(value)
	return string(out), err
}

// Validate the partial archive independently of current player records: an
// operator may have updated an account since importing its historical data.
func validateJSONArchive(id int64, raw []byte) error {
	var user railsJSONUser
	if err := decodeRailsJSON(raw, &user); err != nil {
		return err
	}
	if user.ID != id || id <= 0 || user.Username == "" || user.Admin == nil {
		return errors.New("invalid archived user")
	}
	for _, timestamp := range []string{user.CreatedAt, user.UpdatedAt} {
		if _, err := normalizeImportedTime(timestamp); err != nil {
			return err
		}
	}
	if len(user.Entities) == 0 || bytes.Equal(bytes.TrimSpace(user.Entities), []byte("null")) {
		return errors.New("missing archived entities array")
	}
	var entities []railsJSONEntity
	if err := decodeRailsJSON(user.Entities, &entities); err != nil {
		return err
	}
	ids, kinds := make(map[int64]bool), make(map[string]bool)
	for _, e := range entities {
		if e.ID <= 0 || ids[e.ID] {
			return errors.New("invalid archived entity ID")
		}
		ids[e.ID] = true
		for _, timestamp := range []*string{e.CreatedTime, e.ModifiedTime} {
			if timestamp != nil {
				if _, err := normalizeImportedTime(*timestamp); err != nil {
					return err
				}
			}
		}
		if e.Kind != nil && slices.Contains([]string{"click_count", "streak_counter_day", "streak_counter_month", "streak_counter_year"}, *e.Kind) {
			if kinds[*e.Kind] || (e.Count != nil && *e.Count < 0) {
				return errors.New("invalid archived gameplay entity")
			}
			kinds[*e.Kind] = true
		}
	}
	return nil
}

// ImportRailsJSON imports the Rails admin download as a progress-only source.
// Missing passwords are replaced with an unguessable, discarded random secret;
// an operator must set a new password before a newly imported user can sign in.
// Each original user object (including every nested entity) is archived without
// inventing the entity row timestamps that the Rails download omits.
func (s *Store) ImportRailsJSON(ctx context.Context, path string, audit ...ImportAudit) (ImportResult, error) {
	info, err := os.Stat(path)
	if err != nil {
		return ImportResult{}, err
	}
	if !info.Mode().IsRegular() {
		return ImportResult{}, errors.New("Rails JSON source must be a regular file")
	}
	file, err := os.Open(path)
	if err != nil {
		return ImportResult{}, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, MaxRailsJSONBytes+1))
	if err != nil {
		return ImportResult{}, err
	}
	if len(data) > MaxRailsJSONBytes {
		return ImportResult{}, errors.New("Rails JSON export exceeds 16 MiB")
	}
	var export struct {
		ExportedAt string            `json:"exported_at"`
		TotalUsers *int              `json:"total_users"`
		Users      []json.RawMessage `json:"users"`
	}
	if err := decodeRailsJSON(data, &export); err != nil {
		return ImportResult{}, fmt.Errorf("invalid Rails admin JSON: %w", err)
	}
	if export.TotalUsers == nil || *export.TotalUsers != len(export.Users) || export.Users == nil {
		return ImportResult{}, errors.New("Rails JSON total_users must match the users array")
	}
	if _, err := normalizeImportedTime(export.ExportedAt); err != nil {
		return ImportResult{}, fmt.Errorf("invalid exported_at: %w", err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ImportResult{}, err
	}
	defer tx.Rollback()
	archivedIDs, err := archiveIdentities(ctx, tx)
	if err != nil {
		return ImportResult{}, err
	}
	var result ImportResult
	users, entities := make(map[int64]bool), make(map[int64]bool)
	var lockedHash string
	for _, raw := range export.Users {
		var user railsJSONUser
		if err := decodeRailsJSON(raw, &user); err != nil {
			return ImportResult{}, fmt.Errorf("invalid Rails JSON user: %w", err)
		}
		if user.ID <= 0 || users[user.ID] || user.Username == "" || user.Admin == nil {
			return ImportResult{}, errors.New("Rails JSON has invalid or duplicate user records")
		}
		users[user.ID] = true
		created, err := normalizeImportedTime(user.CreatedAt)
		if err != nil {
			return ImportResult{}, fmt.Errorf("user %d created_at: %w", user.ID, err)
		}
		updated, err := normalizeImportedTime(user.UpdatedAt)
		if err != nil {
			return ImportResult{}, fmt.Errorf("user %d updated_at: %w", user.ID, err)
		}
		if len(user.Entities) == 0 || bytes.Equal(bytes.TrimSpace(user.Entities), []byte("null")) {
			return ImportResult{}, fmt.Errorf("user %d has no entities array; re-export with Fetch User Entities enabled", user.ID)
		}
		var rows []json.RawMessage
		if err := decodeRailsJSON(user.Entities, &rows); err != nil {
			return ImportResult{}, fmt.Errorf("user %d entities: %w", user.ID, err)
		}
		state := &canonicalCounters{seen: make(map[string]bool)}
		for _, row := range rows {
			var entity railsJSONEntity
			if err := decodeRailsJSON(row, &entity); err != nil {
				return ImportResult{}, fmt.Errorf("user %d entity: %w", user.ID, err)
			}
			if entity.ID <= 0 || entities[entity.ID] {
				return ImportResult{}, errors.New("Rails JSON has invalid or duplicate entity IDs")
			}
			entities[entity.ID] = true
			for _, timestamp := range []*string{entity.CreatedTime, entity.ModifiedTime} {
				if timestamp != nil {
					if _, err := normalizeImportedTime(*timestamp); err != nil {
						return ImportResult{}, fmt.Errorf("entity %d timestamp: %w", entity.ID, err)
					}
				}
			}
			if entity.Kind != nil && slices.Contains([]string{"click_count", "streak_counter_day", "streak_counter_month", "streak_counter_year"}, *entity.Kind) {
				if state.seen[*entity.Kind] {
					return ImportResult{}, fmt.Errorf("user %d has duplicate %s entities", user.ID, *entity.Kind)
				}
				state.seen[*entity.Kind] = true
				var count int64
				if entity.Count != nil {
					count = *entity.Count
				}
				if count < 0 {
					return ImportResult{}, fmt.Errorf("entity %d has a negative gameplay count", entity.ID)
				}
				switch *entity.Kind {
				case "click_count":
					state.clicks = count
					if entity.ModifiedTime != nil {
						normalized, _ := normalizeImportedTime(*entity.ModifiedTime)
						state.lastClicked = &normalized
					}
				case "streak_counter_day":
					state.day = count
				case "streak_counter_month":
					state.month = count
				case "streak_counter_year":
					state.year = count
				}
			}
			result.Entities++
		}
		payload, err := canonicalJSON(raw)
		if err != nil {
			return ImportResult{}, err
		}
		var archived string
		err = tx.QueryRowContext(ctx, `SELECT payload FROM rails_json_users WHERE user_id=?`, user.ID).Scan(&archived)
		if err == nil && archived != payload {
			return ImportResult{}, fmt.Errorf("%w: JSON archive for user %d differs; refusing to overwrite", ErrConflict, user.ID)
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return ImportResult{}, err
		}
		var hash string
		err = tx.QueryRowContext(ctx, `SELECT password_hash FROM users WHERE id=?`, user.ID).Scan(&hash)
		if errors.Is(err, sql.ErrNoRows) {
			if lockedHash == "" {
				secret := make([]byte, 32)
				if _, err := rand.Read(secret); err != nil {
					return ImportResult{}, err
				}
				generated, err := bcrypt.GenerateFromPassword([]byte(hex.EncodeToString(secret)), bcrypt.DefaultCost)
				if err != nil {
					return ImportResult{}, err
				}
				lockedHash = string(generated)
			}
			hash = lockedHash
		} else if err != nil {
			return ImportResult{}, err
		}
		if user.Email != nil && *user.Email == "" {
			user.Email = nil
		}
		if err := ensureImportedUser(ctx, tx, user.ID, user.Username, user.Email, hash, *user.Admin, created, updated); err != nil {
			return ImportResult{}, err
		}
		// A partial JSON archive and full SQLite archive must not silently claim
		// the same entity IDs. Use the primary SQLite source for a full cutover.
		for _, row := range rows {
			var e railsJSONEntity
			_ = json.Unmarshal(row, &e)
			identity, occupied := archivedIDs[e.ID]
			if occupied && (identity.source != "json" || identity.userID != user.ID) {
				return ImportResult{}, fmt.Errorf("%w: entity ID %d is already archived; refusing to overwrite", ErrConflict, e.ID)
			}
		}
		if archived == "" {
			if _, err := tx.ExecContext(ctx, `INSERT INTO rails_json_users(user_id,payload) VALUES (?,?)`, user.ID, payload); err != nil {
				return ImportResult{}, err
			}
		}
		if len(state.seen) > 0 {
			if err := insertCounters(ctx, tx, user.ID, state); err != nil {
				return ImportResult{}, err
			}
			result.Counters++
		} else {
			var count int
			if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM counters WHERE user_id=?`, user.ID).Scan(&count); err != nil {
				return ImportResult{}, err
			}
			if count != 0 {
				return ImportResult{}, fmt.Errorf("%w: user %d already has a different counter set", ErrConflict, user.ID)
			}
		}
		result.Users++
	}
	if err := recordImportAudit(ctx, tx, "json", result, audit); err != nil {
		return ImportResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ImportResult{}, err
	}
	return result, nil
}
