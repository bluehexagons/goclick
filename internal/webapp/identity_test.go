package webapp

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"path/filepath"
	"testing"
	"time"

	"github.com/bluehexagons/goclick/internal/store"
	"golang.org/x/crypto/bcrypt"
)

func TestOverlappingLegacyIdentifiersRequireExplicitChoice(t *testing.T) {
	for _, reversed := range []bool{false, true} {
		for _, sharedPassword := range []bool{false, true} {
			name := "different passwords"
			if sharedPassword {
				name = "shared password"
			}
			if reversed {
				name += "/reversed IDs"
			}
			t.Run(name, func(t *testing.T) {
				db, err := store.Open(filepath.Join(t.TempDir(), "target.db"))
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { db.Close() })
				usernameID, emailID := int64(1), int64(2)
				if reversed {
					usernameID, emailID = emailID, usernameID
				}
				usernamePassword, emailPassword := "username-password", "email-password"
				if sharedPassword {
					emailPassword = usernamePassword
				}
				sourcePath := filepath.Join(t.TempDir(), "rails.sqlite3")
				source, err := sql.Open("sqlite", sourcePath)
				if err != nil {
					t.Fatal(err)
				}
				defer source.Close()
				if _, err := source.Exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,email TEXT,password_digest TEXT,admin INTEGER,created_at TEXT,updated_at TEXT);
CREATE TABLE entities(id INTEGER PRIMARY KEY,user_id INTEGER,kind TEXT,count INTEGER,created_time TEXT,modified_time TEXT,created_at TEXT,updated_at TEXT);`); err != nil {
					t.Fatal(err)
				}
				for _, account := range []struct {
					id                        int64
					username, email, password string
					admin                     bool
				}{
					{usernameID, "shared@example.com", "legacy@example.com", usernamePassword, true},
					{emailID, "email_owner", "shared@example.com", emailPassword, false},
				} {
					hash, err := bcrypt.GenerateFromPassword([]byte(account.password), bcrypt.DefaultCost)
					if err != nil {
						t.Fatal(err)
					}
					if _, err := source.Exec(`INSERT INTO users VALUES (?,?,?,?,?,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`, account.id, account.username, account.email, string(hash), account.admin); err != nil {
						t.Fatal(err)
					}
				}
				if err := source.Close(); err != nil {
					t.Fatal(err)
				}
				if _, err := db.ImportRails(context.Background(), sourcePath); err != nil {
					t.Fatal(err)
				}
				now := time.Now()
				app, err := New(db, Config{Now: func() time.Time { return now }, passwordCost: bcrypt.MinCost, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
				if err != nil {
					t.Fatal(err)
				}
				jar, _ := cookiejar.New(nil)
				client := &http.Client{Jar: jar, Transport: handlerTransport{handler: app.Handler()}}
				login := func(identifier, password, kind string) *http.Response {
					now = now.Add(time.Minute)
					payload := map[string]string{"username": identifier, "password": password}
					if kind != "" {
						payload["identifier_type"] = kind
					}
					return jsonRequest(t, client, "POST", "http://goclick.test/api/auth/login", payload, nil)
				}
				assertIdentity := func(response *http.Response, id int64) {
					t.Helper()
					if response.StatusCode != http.StatusOK {
						t.Fatalf("login failed: %d %s", response.StatusCode, readBody(t, response))
					}
					var result struct {
						User publicUserResponse `json:"user"`
					}
					decodeResponse(t, response, &result)
					if result.User.ID != id || result.User.Admin != (id == usernameID) {
						t.Fatalf("signed into unintended account: %+v", result.User)
					}
				}
				assertIdentity(login("email_owner", emailPassword, ""), emailID)
				for _, password := range []string{usernamePassword, emailPassword} {
					response := login("shared@example.com", password, "")
					if response.StatusCode != http.StatusUnauthorized || len(response.Cookies()) != 0 {
						t.Fatalf("ambiguous login selected an account: %d %s", response.StatusCode, readBody(t, response))
					}
					response.Body.Close()
					response = jsonRequest(t, client, "GET", "http://goclick.test/api/me", nil, nil)
					var user publicUserResponse
					decodeResponse(t, response, &user)
					if user.ID != emailID {
						t.Fatal("rejected login changed the existing session")
					}
				}
				assertIdentity(login("shared@example.com", usernamePassword, "username"), usernameID)
				assertIdentity(login("shared@example.com", emailPassword, "email"), emailID)
				response := login("shared@example.com", emailPassword, "unsupported")
				if response.StatusCode != http.StatusBadRequest || len(response.Cookies()) != 0 {
					t.Fatalf("unknown identifier choice accepted: %d", response.StatusCode)
				}
				response.Body.Close()
			})
		}
	}
}
