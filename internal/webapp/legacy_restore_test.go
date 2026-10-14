package webapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bluehexagons/goclick/internal/store"
	"golang.org/x/crypto/bcrypt"
)

func TestRestoreEndpointMigratesRailsSchemaZeroWithIDCollision(t *testing.T) {
	app, db, client, id := adminTestApp(t)
	path := filepath.Join(t.TempDir(), "rails.sqlite3")
	source, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("old-password"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.Exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,email TEXT,password_digest TEXT,admin INTEGER,created_at TEXT,updated_at TEXT);
CREATE TABLE entities(id INTEGER PRIMARY KEY,user_id INTEGER,kind TEXT,count INTEGER,created_time TEXT,modified_time TEXT,created_at TEXT,updated_at TEXT);
INSERT INTO entities VALUES (101,1,'click_count',987,NULL,'2026-09-29T19:30:00Z','2024-01-01T10:00:00Z','2026-09-29T19:30:00Z'),(102,1,'custom_kind',NULL,NULL,NULL,'2024-01-01T10:00:00Z','2026-09-29T19:30:00Z');`); err != nil {
		t.Fatal(err)
	}
	if _, err := source.Exec(`INSERT INTO users VALUES (1,'rails_admin',NULL,?,1,'2024-01-01T10:00:00Z','2026-09-29T19:30:00Z')`, string(hash)); err != nil {
		t.Fatal(err)
	}
	var version int
	if err := source.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version != 0 {
		t.Fatal("fixture must have Rails schema version zero")
	}
	source.Close()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	response := multipartDatabase(t, client, "/api/admin/import/rails", data, "password123", "IMPORT")
	if response.StatusCode != 409 {
		t.Fatalf("merge collision: %d %s", response.StatusCode, readBody(t, response))
	}
	body := readBody(t, response)
	if !strings.Contains(body, "Restore or migrate a database") || !strings.Contains(body, "import_conflict") {
		t.Fatalf("no actionable conflict message: %s", body)
	}
	user, err := db.UserByID(context.Background(), id)
	if err != nil || user.Username != "test_admin" {
		t.Fatal("merge changed conflicting user")
	}
	response = multipartRestore(t, client, data, "password123", "IMPORT")
	if response.StatusCode != 400 {
		t.Fatal("replacement did not require RESTORE")
	}
	response.Body.Close()
	response = multipartRestore(t, client, data, "password123", "RESTORE")
	if response.StatusCode != 200 {
		t.Fatalf("Rails replacement: %d %s", response.StatusCode, readBody(t, response))
	}
	var result store.RestoreResult
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if result.SourceFormat != "rails_sqlite" || result.Users != 1 || result.Entities != 2 {
		t.Fatalf("replacement result: %+v", result)
	}
	if _, err := os.Stat(filepath.Join(app.backupDir, result.RecoveryBackup)); err != nil {
		t.Fatal("missing recovery snapshot")
	}
	user, err = db.UserByID(context.Background(), 1)
	if err != nil || user.PasswordHash != string(hash) || user.Username != "rails_admin" {
		t.Fatal("source ID or password changed")
	}
	response = jsonRequest(t, client, "GET", "http://goclick.test/api/me", nil, nil)
	if response.StatusCode != 401 {
		t.Fatal("old session survived reused user ID")
	}
	response.Body.Close()
	response = jsonRequest(t, client, "POST", "http://goclick.test/api/auth/login", map[string]string{"username": "rails_admin", "password": "old-password"}, nil)
	if response.StatusCode != 200 {
		t.Fatal("Rails password cannot sign in", readBody(t, response))
	}
	response.Body.Close()
	response = jsonRequest(t, client, "GET", "http://goclick.test/api/admin/players/1/entities", nil, nil)
	if response.StatusCode != 200 || !strings.Contains(readBody(t, response), "custom_kind") {
		t.Fatal("migrated admin cannot inspect archive")
	}
}

func TestJSONReplacementThroughRestoreSetsExplicitAdministratorPassword(t *testing.T) {
	_, db, client, _ := adminTestApp(t)
	data, err := os.ReadFile("../store/testdata/rails-admin-export.json")
	if err != nil {
		t.Fatal(err)
	}
	// Reproduce the ID-1 collision with the bootstrap administrator.
	data = []byte(strings.Replace(string(data), `"id": 42`, `"id": 1`, 1))
	response := multipartRestore(t, client, data, "password123", "RESTORE")
	if response.StatusCode != 422 || !strings.Contains(readBody(t, response), "JSON replacement requires") {
		t.Fatal("JSON replacement accepted missing administrator access")
	}
	access := map[string]string{"admin_username": "old_admin", "admin_password": "new-admin-password", "admin_password_confirmation": "mismatch"}
	response = multipartDatabaseWithAccess(t, client, "/api/admin/backups/restore", data, "password123", "RESTORE", access)
	if response.StatusCode != 400 {
		t.Fatal("accepted mismatched passwords")
	}
	response.Body.Close()
	access["admin_password_confirmation"] = access["admin_password"]
	response = multipartDatabaseWithAccess(t, client, "/api/admin/backups/restore", data, "password123", "RESTORE", access)
	if response.StatusCode != 200 {
		t.Fatal("JSON replacement failed", readBody(t, response))
	}
	var result store.RestoreResult
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if result.SourceFormat != "rails_json" || result.AdminUsername != "old_admin" {
		t.Fatalf("JSON replacement result: %+v", result)
	}
	response = jsonRequest(t, client, "POST", "http://goclick.test/api/auth/login", map[string]string{"username": "old_admin", "password": "new-admin-password"}, nil)
	if response.StatusCode != 200 {
		t.Fatal("JSON administrator cannot sign in", readBody(t, response))
	}
	response.Body.Close()
	counters, err := db.CurrentCounters(context.Background(), 1)
	if err != nil || counters.Clicks != 987 {
		t.Fatal("JSON progress was not preserved")
	}
	audit, _, err := db.Audit(context.Background(), 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range audit {
		if strings.Contains(event.ActorUsername, access["admin_password"]) {
			t.Fatal("password appeared in audit")
		}
	}
	user, err := db.UserByID(context.Background(), 1)
	if err != nil || !user.Admin || user.UpdatedAt.Before(time.Now().Add(-time.Minute)) {
		t.Fatal("JSON administrator access setup was not applied")
	}
}
