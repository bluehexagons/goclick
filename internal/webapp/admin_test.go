package webapp

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bluehexagons/goclick/internal/store"
	"golang.org/x/crypto/bcrypt"
)

func adminTestApp(t *testing.T) (*App, *store.Store, *http.Client, int64) {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	app, err := New(db, Config{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), passwordCost: bcrypt.MinCost, BackupDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	user, err := db.CreateUser(context.Background(), "test_admin", nil, string(hash), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := db.SetAdmin(context.Background(), user.ID, true, time.Now()); err != nil {
		t.Fatal(err)
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar, Transport: handlerTransport{handler: app.Handler()}}
	response := jsonRequest(t, client, "POST", "http://goclick.test/api/auth/login", map[string]string{"username": user.Username, "password": "password123"}, nil)
	if response.StatusCode != 200 {
		t.Fatalf("admin login = %d %s", response.StatusCode, readBody(t, response))
	}
	if response.Cookies()[0].MaxAge != int(store.AdminSessionTTL.Seconds()) {
		t.Fatal("admin session lifetime was not shortened")
	}
	response.Body.Close()
	return app, db, client, user.ID
}

func TestAdminEndpointsRequireServerSideAuthorization(t *testing.T) {
	app, _, _, _ := adminTestApp(t)
	guest := &http.Client{Transport: handlerTransport{handler: app.Handler()}}
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	player := &http.Client{Jar: jar, Transport: guest.Transport}
	response := jsonRequest(t, player, "POST", "http://goclick.test/api/auth/signup", map[string]string{"username": "regular_player", "password": "password123"}, nil)
	if response.StatusCode != 201 {
		t.Fatal(response.Status)
	}
	response.Body.Close()
	for _, endpoint := range []struct{ method, path string }{
		{"GET", "/admin"}, {"GET", "/admin.html"}, {"GET", "/api/admin/overview"}, {"GET", "/api/admin/players"}, {"GET", "/api/admin/players/1"}, {"GET", "/api/admin/players/1/entities"}, {"GET", "/api/admin/activity"}, {"GET", "/api/admin/audit"}, {"POST", "/api/admin/backups/export"}, {"POST", "/api/admin/backups/restore"},
	} {
		for _, test := range []struct {
			client *http.Client
			want   int
		}{{guest, 401}, {player, 403}} {
			response := jsonRequest(t, test.client, endpoint.method, "http://goclick.test"+endpoint.path, nil, nil)
			if response.StatusCode != test.want {
				t.Fatalf("%s %s status=%d want=%d", endpoint.method, endpoint.path, response.StatusCode, test.want)
			}
			response.Body.Close()
		}
	}
	response = jsonRequest(t, player, "POST", "http://goclick.test/api/auth/signup", map[string]any{"username": "promotion_attempt", "password": "password123", "admin": true}, nil)
	if response.StatusCode != 400 {
		t.Fatalf("public signup accepted admin flag: %d", response.StatusCode)
	}
	response.Body.Close()
}

func TestAdminPlayerStatsResponsesAndFilters(t *testing.T) {
	_, _, client, id := adminTestApp(t)
	response := jsonRequest(t, client, "POST", "http://goclick.test/api/clicks", nil, nil)
	response.Body.Close()
	for _, path := range []string{"/admin", "/api/admin/overview", "/api/admin/players", "/api/admin/players/1", "/api/admin/players/1/entities", "/api/admin/activity", "/api/admin/audit"} {
		response := jsonRequest(t, client, "GET", "http://goclick.test"+path, nil, nil)
		body := readBody(t, response)
		if response.StatusCode != 200 {
			t.Fatalf("%s: %d %s", path, response.StatusCode, body)
		}
		for _, secret := range []string{"password_hash", "PasswordHash", "token_hash", "PasswordHash"} {
			if strings.Contains(body, secret) {
				t.Fatalf("%s exposed %s", path, secret)
			}
		}
		if response.Header.Get("Cache-Control") != "no-store" {
			t.Fatalf("%s may be cached", path)
		}
	}
	response = jsonRequest(t, client, "GET", "http://goclick.test/api/admin/activity?user_id=1&limit=1", nil, nil)
	var activity struct {
		Items []store.Activity
		Total int64
	}
	decodeResponse(t, response, &activity)
	if len(activity.Items) != 1 || activity.Items[0].UserID != id || activity.Items[0].Action != "click" || activity.Total != 3 {
		t.Fatalf("activity: %+v", activity)
	}
	for _, path := range []string{"/api/admin/players?page=0", "/api/admin/players?limit=101", "/api/admin/players?sort=DROP%20TABLE%20users", "/api/admin/players/nope", "/api/admin/activity?user_id=-1"} {
		response := jsonRequest(t, client, "GET", "http://goclick.test"+path, nil, nil)
		if response.StatusCode != 400 {
			t.Fatalf("invalid query %s = %d", path, response.StatusCode)
		}
		response.Body.Close()
	}
	response = jsonRequest(t, client, "GET", "http://goclick.test/api/admin/players/9999", nil, nil)
	if response.StatusCode != 404 {
		t.Fatal("missing player did not return 404")
	}
	response.Body.Close()
}

func multipartRestore(t *testing.T, client *http.Client, backup []byte, password, confirmation string) *http.Response {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	writer.WriteField("password", password)
	writer.WriteField("confirmation", confirmation)
	part, err := writer.CreateFormFile("backup", "backup.db")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(backup); err != nil {
		t.Fatal(err)
	}
	writer.Close()
	r, err := http.NewRequest("POST", "http://goclick.test/api/admin/backups/restore", &body)
	if err != nil {
		t.Fatal(err)
	}
	r.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := client.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func TestAdminExportRestoreRoundTrip(t *testing.T) {
	_, _, client, _ := adminTestApp(t)
	response := jsonRequest(t, client, "POST", "http://goclick.test/api/clicks", nil, nil)
	response.Body.Close()
	response = jsonRequest(t, client, "POST", "http://goclick.test/api/admin/backups/export", map[string]string{"password": "password123"}, nil)
	if response.StatusCode != 200 {
		t.Fatalf("export status=%d %s", response.StatusCode, readBody(t, response))
	}
	if !strings.Contains(response.Header.Get("Content-Disposition"), "attachment;") || response.Header.Get("Content-Type") != "application/octet-stream" {
		t.Fatal("missing download headers")
	}
	backup, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(backup, []byte("SQLite format 3\x00")) {
		t.Fatal("export is not SQLite")
	}
	response = jsonRequest(t, client, "POST", "http://goclick.test/api/clicks", nil, nil)
	var secondClick entitiesResponse
	decodeResponse(t, response, &secondClick)
	if secondClick.ClickCount == nil || secondClick.ClickCount.Count != 2 {
		t.Fatalf("subsequent click did not return saved counters: %+v", secondClick)
	}
	response = multipartRestore(t, client, backup, "password123", "RESTORE")
	if response.StatusCode != 200 {
		t.Fatalf("restore status=%d %s", response.StatusCode, readBody(t, response))
	}
	var result store.RestoreResult
	decodeResponse(t, response, &result)
	if result.Users != 1 || result.RecoveryBackup == "" {
		t.Fatalf("restore result=%+v", result)
	}
	response = jsonRequest(t, client, "GET", "http://goclick.test/api/admin/overview", nil, nil)
	if response.StatusCode != 401 {
		t.Fatalf("restore retained session: %d", response.StatusCode)
	}
	response.Body.Close()
	response = jsonRequest(t, client, "POST", "http://goclick.test/api/auth/login", map[string]string{"username": "test_admin", "password": "password123"}, nil)
	if response.StatusCode != 200 {
		t.Fatal("original password stopped working")
	}
	response.Body.Close()
	response = jsonRequest(t, client, "GET", "http://goclick.test/api/admin/overview", nil, nil)
	var stats store.Overview
	decodeResponse(t, response, &stats)
	if stats.Clicks != 1 || stats.Admins != 1 {
		t.Fatalf("restored stats=%+v", stats)
	}
}

func TestBackupOperationsRequirePasswordAndRejectCrossOrigin(t *testing.T) {
	_, _, client, _ := adminTestApp(t)
	response := jsonRequest(t, client, "POST", "http://goclick.test/api/admin/backups/export", map[string]string{"password": "password123"}, map[string]string{"Sec-Fetch-Site": "same-site", "Origin": "https://sibling.goclick.test"})
	if response.StatusCode != 403 {
		t.Fatal("cross-origin backup export accepted")
	}
	response.Body.Close()
	response = jsonRequest(t, client, "POST", "http://goclick.test/api/admin/backups/export", map[string]string{"password": "wrong"}, nil)
	if response.StatusCode != 403 {
		t.Fatal("backup export accepted wrong password")
	}
	response.Body.Close()
	response = multipartRestore(t, client, []byte("invalid"), "wrong", "RESTORE")
	if response.StatusCode != 403 {
		t.Fatal("restore accepted wrong password")
	}
	response.Body.Close()
	response = multipartRestore(t, client, []byte("invalid"), "password123", "RESTORE")
	if response.StatusCode != 422 {
		t.Fatalf("invalid backup status=%d %s", response.StatusCode, readBody(t, response))
	}
	response.Body.Close()
	response = jsonRequest(t, client, "GET", "http://goclick.test/api/admin/overview", nil, nil)
	if response.StatusCode != 200 {
		t.Fatal("invalid restore signed out current admin")
	}
	response.Body.Close()
	response = jsonRequest(t, client, "POST", "http://goclick.test/api/admin/backups/export", map[string]string{"password": "password123"}, nil)
	if response.StatusCode != 429 {
		t.Fatal("admin password attempts were not limited")
	}
	response.Body.Close()
}

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) { clear(p); return len(p), nil }

func TestRestoreUploadLimitAlsoBoundsChunkedEpilogue(t *testing.T) {
	_, _, client, _ := adminTestApp(t)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	writer.WriteField("password", "password123")
	writer.WriteField("confirmation", "RESTORE")
	part, _ := writer.CreateFormFile("backup", "backup.db")
	part.Write([]byte("invalid"))
	writer.Close()
	r, err := http.NewRequest("POST", "http://goclick.test/api/admin/backups/restore", io.MultiReader(bytes.NewReader(body.Bytes()), io.LimitReader(zeroReader{}, maxRestoreBody)))
	if err != nil {
		t.Fatal(err)
	}
	r.ContentLength = -1
	r.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := client.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 413 {
		data, _ := json.Marshal(response.Status)
		t.Fatalf("oversized chunked restore status=%s", data)
	}
}

func TestAdminDemotionTakesEffectImmediately(t *testing.T) {
	_, db, client, id := adminTestApp(t)
	hash, _ := bcrypt.GenerateFromPassword([]byte("another password"), bcrypt.MinCost)
	user, err := db.CreateUser(context.Background(), "second_admin", nil, string(hash), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := db.SetAdmin(context.Background(), user.ID, true, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := db.SetAdmin(context.Background(), id, false, time.Now()); err != nil {
		t.Fatal(err)
	}
	response := jsonRequest(t, client, "GET", "http://goclick.test/api/admin/players", nil, nil)
	if response.StatusCode != 401 {
		t.Fatal("demoted administrator retained session")
	}
	response.Body.Close()
}
