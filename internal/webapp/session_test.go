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
	"strconv"
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
				if response.StatusCode != http.StatusOK || len(response.Cookies()) != 0 {
					t.Fatalf("ordinary activity changed cookies or expired: status=%d cookies=%d", response.StatusCode, len(response.Cookies()))
				}
				if response.Header.Get("X-GoClick-User-ID") != strconv.FormatInt(user.ID, 10) || response.Header.Get("X-GoClick-Session-Expires") != strconv.FormatInt(now.Add(lifetime).Unix(), 10) {
					t.Fatal("missing authenticated renewal metadata")
				}
				response = jsonRequest(t, client, "POST", "https://goclick.test/api/auth/renew", nil, map[string]string{"X-GoClick-User-ID": strconv.FormatInt(user.ID, 10)})
				response.Body.Close()
				if response.StatusCode != http.StatusOK || len(response.Cookies()) != 1 {
					t.Fatalf("explicit renewal failed: status=%d cookies=%d", response.StatusCode, len(response.Cookies()))
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
			if response.StatusCode != http.StatusUnauthorized || len(response.Cookies()) != 0 {
				t.Fatal("inactivity did not expire the session without changing cookies")
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
	if response.Code != http.StatusOK || len(response.Result().Cookies()) != 0 {
		t.Fatal("ordinary authentication unexpectedly changed the cookie")
	}
	request = httptest.NewRequest("POST", "https://goclick.test/api/auth/renew", nil)
	request.AddCookie(&http.Cookie{Name: sessionCookie, Value: value})
	request.Header.Set("X-GoClick-User-ID", strconv.FormatInt(id, 10))
	response = httptest.NewRecorder()
	app.Handler().ServeHTTP(response, request)
	cookies := response.Result().Cookies()
	if response.Code != http.StatusOK || len(cookies) != 1 || cookies[0].Value != value || !cookies[0].Expires.Equal(now.Add(180*24*time.Hour)) {
		t.Fatalf("legacy admin session was not upgraded in place: status=%d", response.Code)
	}
}

func TestSessionRenewalRequiresCurrentIdentity(t *testing.T) {
	_, _, client, id := adminTestApp(t)
	for _, expected := range []string{"", "0", "01", "invalid", strconv.FormatInt(id+1, 10)} {
		response := jsonRequest(t, client, "POST", "http://goclick.test/api/auth/renew", nil, map[string]string{"X-GoClick-User-ID": expected})
		response.Body.Close()
		if response.StatusCode != http.StatusConflict || len(response.Cookies()) != 0 {
			t.Fatalf("renewal accepted a missing/stale identity %q: status=%d", expected, response.StatusCode)
		}
	}
	response := jsonRequest(t, client, "POST", "http://goclick.test/api/auth/renew", nil, map[string]string{"X-GoClick-User-ID": strconv.FormatInt(id, 10)})
	response.Body.Close()
	if response.StatusCode != http.StatusOK || len(response.Cookies()) != 1 {
		t.Fatalf("current identity could not renew: %d", response.StatusCode)
	}
}

func TestPasswordResetDuringLoginCannotIssueSession(t *testing.T) {
	app, db, client, id := adminTestApp(t)
	// The limiter retains its own clock. Session creation calls app.now only
	// after bcrypt has verified the submitted password, making this ordering
	// deterministic without relying on timing a slow hash in another goroutine.
	now := time.Now().UTC()
	app.now = func() time.Time {
		if err := db.SetPassword(context.Background(), id, "replacement-password", now); err != nil {
			t.Fatal(err)
		}
		return now
	}
	response := jsonRequest(t, client, "POST", "http://goclick.test/api/auth/login", map[string]string{"username": "test_admin", "password": "password123"}, nil)
	defer response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized || len(response.Cookies()) != 0 {
		t.Fatalf("stale login issued a session: status=%d cookies=%d", response.StatusCode, len(response.Cookies()))
	}
	app.now = func() time.Time { return now }
	response = jsonRequest(t, client, "GET", "http://goclick.test/api/me", nil, nil)
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("reset session revived: %d", response.StatusCode)
	}
	response = jsonRequest(t, client, "POST", "http://goclick.test/api/auth/login", map[string]string{"username": "test_admin", "password": "replacement-password"}, nil)
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("new password login failed: %d", response.StatusCode)
	}
}

func TestPasswordResetDuringSignupCannotIssueSession(t *testing.T) {
	app, db, client, previousID := adminTestApp(t)
	now := time.Now().UTC()
	calls := 0
	app.now = func() time.Time {
		calls++
		if calls == 2 { // Signup created the account; session creation is next.
			user, err := db.UserByUsername(context.Background(), "signup_reset")
			if err != nil {
				t.Fatal(err)
			}
			if err := db.SetPassword(context.Background(), user.ID, "replacement-password", now); err != nil {
				t.Fatal(err)
			}
		}
		return now
	}
	response := jsonRequest(t, client, "POST", "http://goclick.test/api/auth/signup", map[string]string{"username": "signup_reset", "password": "password123"}, nil)
	response.Body.Close()
	if calls != 2 || response.StatusCode != http.StatusUnauthorized || len(response.Cookies()) != 0 {
		t.Fatalf("stale signup issued a session: status=%d cookies=%d calls=%d", response.StatusCode, len(response.Cookies()), calls)
	}
	app.now = func() time.Time { return now }
	response = jsonRequest(t, client, "GET", "http://goclick.test/api/me", nil, nil)
	var user publicUserResponse
	decodeResponse(t, response, &user)
	if response.StatusCode != http.StatusOK || user.ID != previousID {
		t.Fatal("failed signup revoked the previously signed-in account's session")
	}
}
