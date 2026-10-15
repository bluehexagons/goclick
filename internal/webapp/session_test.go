package webapp

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/bluehexagons/goclick/internal/store"
	"golang.org/x/crypto/bcrypt"
)

func TestActivePlayersAndAdminsStaySignedInAcrossOriginalExpiry(t *testing.T) {
	for _, admin := range []bool{false, true} {
		name := "player"
		if admin {
			name = "admin"
		}
		t.Run(name, func(t *testing.T) {
			db, err := store.Open(filepath.Join(t.TempDir(), "sessions.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			now := time.Now().UTC().Truncate(time.Second)
			lifetime := 180 * 24 * time.Hour
			app, err := New(db, Config{Now: func() time.Time { return now }, SecureCookies: true, passwordCost: bcrypt.MinCost, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
			if err != nil {
				t.Fatal(err)
			}
			hash, err := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.MinCost)
			if err != nil {
				t.Fatal(err)
			}
			user, err := db.CreateUser(context.Background(), "active_user", nil, string(hash), now)
			if err != nil {
				t.Fatal(err)
			}
			if admin {
				if err := db.SetAdmin(context.Background(), user.ID, true, now); err != nil {
					t.Fatal(err)
				}
			}
			jar, _ := cookiejar.New(nil)
			client := &http.Client{Jar: jar, Transport: handlerTransport{handler: app.Handler()}}
			response := jsonRequest(t, client, "POST", "https://goclick.test/api/auth/login", map[string]string{"username": user.Username, "password": "password123"}, nil)
			if response.StatusCode != http.StatusOK || len(response.Cookies()) != 1 {
				t.Fatalf("login status=%d", response.StatusCode)
			}
			original := response.Cookies()[0]
			response.Body.Close()
			if original.MaxAge != int(lifetime.Seconds()) || !original.Secure || !original.HttpOnly || original.SameSite != http.SameSiteStrictMode {
				t.Fatal("login cookie lost persistence or cookie protections")
			}
			now = now.Add(9 * time.Hour)
			response = jsonRequest(t, client, "GET", "https://goclick.test/api/me", nil, nil)
			response.Body.Close()
			if response.StatusCode != http.StatusOK || len(response.Cookies()) != 0 {
				t.Fatalf("session rejected after eight hours or needlessly rewritten: %d", response.StatusCode)
			}
			for range 8 {
				now = now.Add(60 * 24 * time.Hour)
				response = jsonRequest(t, client, "POST", "https://goclick.test/api/clicks", nil, nil)
				response.Body.Close()
				if response.StatusCode != http.StatusOK || len(response.Cookies()) != 1 {
					t.Fatalf("active session expired: status=%d cookies=%d", response.StatusCode, len(response.Cookies()))
				}
				renewed := response.Cookies()[0]
				if renewed.Value != original.Value || !renewed.Expires.Equal(now.Add(lifetime)) || renewed.MaxAge != int(lifetime.Seconds()) || !renewed.HttpOnly || !renewed.Secure || renewed.SameSite != http.SameSiteStrictMode {
					t.Fatal("cookie was not extended with the same session token and protections")
				}
			}
			if admin {
				response = jsonRequest(t, client, "GET", "https://goclick.test/api/admin/overview", nil, nil)
				var stats store.Overview
				decodeResponse(t, response, &stats)
				if stats.ActiveSessions != 1 {
					t.Fatalf("long-lived admin session missing from statistics: %+v", stats)
				}
			}
			now = now.Add(lifetime)
			response = jsonRequest(t, client, "GET", "https://goclick.test/api/me", nil, nil)
			response.Body.Close()
			if response.StatusCode != http.StatusUnauthorized || len(response.Cookies()) != 1 || response.Cookies()[0].MaxAge >= 0 {
				t.Fatal("inactivity did not expire the session and clear its cookie")
			}
		})
	}
}

func TestExistingShortAdminCookieIsExtendedOnUse(t *testing.T) {
	app, db, _, id := adminTestApp(t)
	now := time.Now().UTC().Truncate(time.Second)
	app.now = func() time.Time { return now }
	raw := bytes.Repeat([]byte{0x51}, 32)
	if err := db.CreateSession(context.Background(), raw, id, now.Add(time.Hour), now.Add(-7*time.Hour)); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("GET", "https://goclick.test/api/me", nil)
	value := base64.RawURLEncoding.EncodeToString(raw)
	request.AddCookie(&http.Cookie{Name: sessionCookie, Value: value})
	response := httptest.NewRecorder()
	app.Handler().ServeHTTP(response, request)
	cookies := response.Result().Cookies()
	if response.Code != http.StatusOK || len(cookies) != 1 || cookies[0].Value != value || !cookies[0].Expires.Equal(now.Add(180*24*time.Hour)) {
		t.Fatalf("legacy admin session was not upgraded in place: status=%d", response.Code)
	}
}
