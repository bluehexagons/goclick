package store

// Validate historical entity archives retained by native Go Click backups.
// New migrations are no longer supported.

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
)

type archivedJSONUser struct {
	ID        int64           `json:"id"`
	Username  string          `json:"username"`
	Email     *string         `json:"email"`
	Admin     *bool           `json:"admin"`
	CreatedAt string          `json:"created_at"`
	UpdatedAt string          `json:"updated_at"`
	Entities  json.RawMessage `json:"entities"`
}

type archivedJSONEntity struct {
	ID           int64   `json:"id"`
	Kind         *string `json:"kind"`
	Count        *int64  `json:"count"`
	CreatedTime  *string `json:"created_time"`
	ModifiedTime *string `json:"modified_time"`
}

func decodeArchiveJSON(data []byte, into any) error {
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
			// encoding/json matches struct fields without regard to case, while
			// SQLite archive JSON paths use the exact archived field names.
			if name != strings.ToLower(name) || strings.IndexFunc(name, func(r rune) bool { return r > 127 }) >= 0 {
				return fmt.Errorf("JSON field %q must use its lowercase archive spelling", name)
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

// Validate the partial archive independently of current player records: an
// operator may have updated an account since importing its historical data.
func validateJSONArchive(id int64, raw []byte) error {
	var user archivedJSONUser
	if err := decodeArchiveJSON(raw, &user); err != nil {
		return err
	}
	if user.ID != id || id <= 0 || user.Username == "" || user.Admin == nil {
		return errors.New("invalid archived user")
	}
	for _, timestamp := range []string{user.CreatedAt, user.UpdatedAt} {
		if _, err := parseTime(timestamp); err != nil {
			return err
		}
	}
	if len(user.Entities) == 0 || bytes.Equal(bytes.TrimSpace(user.Entities), []byte("null")) {
		return errors.New("missing archived entities array")
	}
	var entities []archivedJSONEntity
	if err := decodeArchiveJSON(user.Entities, &entities); err != nil {
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
				if _, err := parseTime(*timestamp); err != nil {
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

// The historical SQLite archive permits nullable gameplay fields, but its row
// timestamps must remain valid when a native Go Click backup is restored.
func validateEntityArchiveTimestamps(row interface{ Scan(...any) error }) error {
	var id, userID int64
	var kind, createdTime, modifiedTime, createdAt, updatedAt sql.NullString
	var count sql.NullInt64
	if err := row.Scan(&id, &userID, &kind, &count, &createdTime, &modifiedTime, &createdAt, &updatedAt); err != nil {
		return err
	}
	if !createdAt.Valid || !updatedAt.Valid {
		return errors.New("entity has no created_at or updated_at")
	}
	for _, timestamp := range []sql.NullString{createdAt, updatedAt, createdTime, modifiedTime} {
		if timestamp.Valid {
			if _, err := parseTime(timestamp.String); err != nil {
				return err
			}
		}
	}
	return nil
}
