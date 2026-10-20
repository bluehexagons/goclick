package store

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func jsonFixture(t *testing.T, change func(map[string]any)) string {
	t.Helper()
	data, err := os.ReadFile("testdata/rails-admin-export.json")
	if err != nil {
		t.Fatal(err)
	}
	if change != nil {
		var export map[string]any
		if err := json.Unmarshal(data, &export); err != nil {
			t.Fatal(err)
		}
		change(export)
		data, err = json.Marshal(export)
		if err != nil {
			t.Fatal(err)
		}
	}
	path := filepath.Join(t.TempDir(), "rails.json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestRailsJSONProgressArchiveIdempotencyAndPasswordSetup(t *testing.T) {
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	path := jsonFixture(t, nil)
	result, err := db.ImportRailsJSON(ctx, path)
	if err != nil || result != (ImportResult{Users: 2, Entities: 6, Counters: 1}) {
		t.Fatalf("import: %+v %v", result, err)
	}
	u, err := db.UserByID(ctx, 42)
	if err != nil || !u.Admin || u.Username != "old_admin" {
		t.Fatalf("user: %+v %v", u, err)
	}
	if _, err := bcrypt.Cost([]byte(u.PasswordHash)); err != nil {
		t.Fatal("missing secure locked password hash")
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte("password123")) == nil {
		t.Fatal("import introduced a known password")
	}
	c, err := db.CurrentCounters(ctx, 42)
	if err != nil || !c.Exists || c.Clicks != 987 || c.DayStreak != 12 || c.MonthStreak != 7 || c.YearStreak != 3 || c.LastClickedAt.Format(time.RFC3339) != "2026-09-29T19:30:00Z" {
		t.Fatalf("counters: %+v %v", c, err)
	}
	entities, total, err := db.ArchivedEntities(ctx, 42, 25, 0)
	if err != nil || total != 6 || entities[4].Kind == nil || *entities[4].Kind != "special_achievement" || *entities[4].Count != -4 || entities[5].Kind != nil || entities[5].Count != nil || entities[0].CreatedAt != nil || entities[0].Source != "json" {
		t.Fatalf("archive: %+v %v", entities, err)
	}
	if _, err := db.ImportRailsJSON(ctx, path); err != nil {
		t.Fatalf("unchanged import: %v", err)
	}
	repeated, _ := db.UserByID(ctx, 42)
	if repeated.PasswordHash != u.PasswordHash {
		t.Fatal("idempotent import changed password")
	}
	if err := db.CreateSession(ctx, []byte("old session"), 42, time.Now().Add(time.Hour), time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := db.SetPassword(ctx, 42, "new-long-password", time.Now()); err != nil {
		t.Fatal(err)
	}
	repeated, _ = db.UserByID(ctx, 42)
	if !repeated.Admin || bcrypt.CompareHashAndPassword([]byte(repeated.PasswordHash), []byte("new-long-password")) != nil {
		t.Fatal("operator password setup failed or changed role")
	}
	if _, err := db.UserBySession(ctx, []byte("old session"), time.Now()); err != ErrNotFound {
		t.Fatalf("old session survived: %v", err)
	}
	backup, err := db.Backup(ctx, t.TempDir(), "json-import")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Increment(ctx, 42, time.Now()); err != nil {
		t.Fatal(err)
	}
	restored, err := db.Restore(ctx, backup, t.TempDir(), repeated, time.Now())
	if err != nil || restored.Entities != 6 {
		t.Fatalf("restore: %+v %v", restored, err)
	}
	c, _ = db.CurrentCounters(ctx, 42)
	if c.Clicks != 987 {
		t.Fatal("JSON progress lost during restore")
	}
	entities, total, err = db.ArchivedEntities(ctx, 42, 25, 0)
	if err != nil || total != 6 || entities[0].CreatedAt != nil {
		t.Fatal("partial archive changed during restore")
	}
}

func TestRailsJSONRejectsIncompleteInvalidAndConflictingImports(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(map[string]any)
	}{
		{"no entities", func(e map[string]any) { delete(e["users"].([]any)[1].(map[string]any), "entities") }},
		{"null entities", func(e map[string]any) { e["users"].([]any)[1].(map[string]any)["entities"] = nil }},
		{"wrong total", func(e map[string]any) { e["total_users"] = 3 }},
		{"duplicate user", func(e map[string]any) { e["users"].([]any)[1].(map[string]any)["id"] = 42 }},
		{"duplicate entity", func(e map[string]any) {
			e["users"].([]any)[1].(map[string]any)["entities"] = []any{e["users"].([]any)[0].(map[string]any)["entities"].([]any)[0]}
		}},
		{"negative clicks", func(e map[string]any) {
			e["users"].([]any)[0].(map[string]any)["entities"].([]any)[0].(map[string]any)["count"] = -1
		}},
		{"bad timestamp", func(e map[string]any) { e["users"].([]any)[1].(map[string]any)["created_at"] = "invalid" }},
		{"credentials in JSON", func(e map[string]any) { e["users"].([]any)[1].(map[string]any)["password_digest"] = "secret" }},
		{"uppercase collection", func(e map[string]any) { e["Users"] = e["users"]; delete(e, "users") }},
		{"uppercase entities", func(e map[string]any) {
			u := e["users"].([]any)[0].(map[string]any)
			u["Entities"] = u["entities"]
			delete(u, "entities")
		}},
		{"Unicode entity alias", func(e map[string]any) {
			u := e["users"].([]any)[0].(map[string]any)
			u["entitie\u017f"] = u["entities"]
			delete(u, "entities")
		}},
		{"uppercase entity ID", func(e map[string]any) {
			entity := e["users"].([]any)[0].(map[string]any)["entities"].([]any)[0].(map[string]any)
			entity["ID"] = entity["id"]
			delete(entity, "id")
		}},
		{"case alias collision", func(e map[string]any) { e["users"].([]any)[0].(map[string]any)["ID"] = 999 }},
	} {
		t.Run(test.name, func(t *testing.T) {
			db, err := Open(":memory:")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			if _, err := db.ImportRailsJSON(context.Background(), jsonFixture(t, test.change)); err == nil {
				t.Fatal("accepted invalid source")
			}
			var count int
			if err := db.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count); err != nil || count != 0 {
				t.Fatal("partial import committed")
			}
		})
	}
	ctx := context.Background()
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	path := jsonFixture(t, nil)
	if _, err := db.ImportRailsJSON(ctx, path); err != nil {
		t.Fatal(err)
	}
	changed := jsonFixture(t, func(e map[string]any) {
		e["users"].([]any)[0].(map[string]any)["entities"].([]any)[4].(map[string]any)["count"] = 9
	})
	if _, err := db.ImportRailsJSON(ctx, changed); err == nil || !strings.Contains(err.Error(), "archive") {
		t.Fatalf("archive conflict: %v", err)
	}
	if _, err := db.Increment(ctx, 42, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ImportRailsJSON(ctx, path); err == nil || !strings.Contains(err.Error(), "counters") {
		t.Fatalf("counter conflict: %v", err)
	}
}

func TestRailsJSONRejectsDuplicateKeysAndPreservesExistingCredentials(t *testing.T) {
	var user railsJSONUser
	if err := decodeRailsJSON([]byte(`{"id":1,"id":2}`), &user); err == nil {
		t.Fatal("accepted ambiguous JSON")
	}
	ctx := context.Background()
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	hash, err := bcrypt.GenerateFromPassword([]byte("existing-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.db.Exec(`INSERT INTO users(id,username,email,password_hash,admin,created_at,updated_at) VALUES (42,'old_admin','old@example.com',?,1,'2024-01-01T10:00:00Z','2026-09-30T10:00:00Z')`, string(hash)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ImportRailsJSON(ctx, jsonFixture(t, nil)); err != nil {
		t.Fatal(err)
	}
	u, err := db.UserByID(ctx, 42)
	if err != nil || u.PasswordHash != string(hash) {
		t.Fatal("existing credentials overwritten")
	}
	if _, err := db.db.Exec(`UPDATE users SET username='different' WHERE id=42`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ImportRailsJSON(ctx, jsonFixture(t, nil)); err == nil {
		t.Fatal("different target user silently overwritten")
	}
}

func TestRailsJSONArchiveDistinguishesMissingFromNullAndRejectsEntityCollisions(t *testing.T) {
	ctx := context.Background()
	db, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	path := jsonFixture(t, func(export map[string]any) {
		delete(export["users"].([]any)[0].(map[string]any)["entities"].([]any)[4].(map[string]any), "created_time")
	})
	if _, err := db.ImportRailsJSON(ctx, path); err != nil {
		t.Fatal(err)
	}
	var payload string
	if err := db.db.QueryRow(`SELECT payload FROM rails_json_users WHERE user_id=42`).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	var user map[string]any
	if err := json.Unmarshal([]byte(payload), &user); err != nil {
		t.Fatal(err)
	}
	entities := user["entities"].([]any)
	if _, exists := entities[4].(map[string]any)["created_time"]; exists {
		t.Fatal("missing field was fabricated")
	}
	if value, exists := entities[5].(map[string]any)["created_time"]; !exists || value != nil {
		t.Fatal("null field was lost")
	}
	collision := jsonFixture(t, func(export map[string]any) {
		export["total_users"] = 1
		export["users"] = export["users"].([]any)[:1]
		u := export["users"].([]any)[0].(map[string]any)
		u["id"] = 99
		u["username"] = "new_player"
		u["email"] = nil
	})
	if _, err := db.ImportRailsJSON(ctx, collision); err == nil || !strings.Contains(err.Error(), "already archived") {
		t.Fatalf("entity collision: %v", err)
	}
	if _, err := db.UserByID(ctx, 99); err != ErrNotFound {
		t.Fatal("entity collision left a partial user")
	}
}
