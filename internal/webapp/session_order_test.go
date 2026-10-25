package webapp

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bluehexagons/goclick/internal/store"
	"golang.org/x/crypto/bcrypt"
)

type delayedSessionHeaders struct {
	*httptest.ResponseRecorder
	entered, release chan struct{}
}

func (w *delayedSessionHeaders) WriteHeader(status int) {
	close(w.entered)
	<-w.release
	w.ResponseRecorder.WriteHeader(status)
}

func TestLateSessionResponsesPreserveNewLogin(t *testing.T) {
	for _, kind := range []string{"activity", "revoked-token-401", "malformed-token-401"} {
		t.Run(kind, func(t *testing.T) {
			ctx := context.Background()
			db, err := store.Open(filepath.Join(t.TempDir(), "review.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			now := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
			hash, err := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.MinCost)
			if err != nil {
				t.Fatal(err)
			}
			first, err := db.CreateUser(ctx, "old_account", nil, string(hash), now)
			if err != nil {
				t.Fatal(err)
			}
			second, err := db.CreateUser(ctx, "new_account", nil, string(hash), now)
			if err != nil {
				t.Fatal(err)
			}
			app, err := New(db, Config{Now: func() time.Time { return now }, passwordCost: bcrypt.MinCost})
			if err != nil {
				t.Fatal(err)
			}
			handler := app.Handler()
			raw := bytes.Repeat([]byte{0x42}, 32)
			if err := db.CreateSession(ctx, raw, first.ID, now.Add(time.Hour), now.Add(-time.Hour)); err != nil {
				t.Fatal(err)
			}
			old := &http.Cookie{Name: sessionCookie, Value: base64.RawURLEncoding.EncodeToString(raw)}
			// This request captured the original cookie before the account switch.
			stale := httptest.NewRequest("GET", "http://goclick.test/api/game", nil)
			if kind == "malformed-token-401" {
				stale.AddCookie(&http.Cookie{Name: sessionCookie, Value: "malformed"})
			} else {
				stale.AddCookie(old)
			}
			late := &delayedSessionHeaders{httptest.NewRecorder(), make(chan struct{}), make(chan struct{})}
			done := make(chan struct{})
			if kind == "activity" {
				go func() { defer close(done); handler.ServeHTTP(late, stale) }()
				select {
				case <-late.entered:
				case <-time.After(5 * time.Second):
					t.Fatal("renewal did not reach response barrier")
				}
			}
			login := httptest.NewRequest("POST", "http://goclick.test/api/auth/login", strings.NewReader(`{"username":"new_account","password":"password123"}`))
			login.Header.Set("Content-Type", "application/json")
			login.AddCookie(old)
			signedIn := httptest.NewRecorder()
			handler.ServeHTTP(signedIn, login)
			if signedIn.Code != http.StatusOK {
				t.Fatalf("login status=%d body=%s", signedIn.Code, signedIn.Body.String())
			}
			origin, _ := url.Parse("http://goclick.test/")
			jar, _ := cookiejar.New(nil)
			jar.SetCookies(origin, signedIn.Result().Cookies())
			fresh := signedIn.Result().Cookies()[0]
			freshRaw, err := base64.RawURLEncoding.DecodeString(fresh.Value)
			if err != nil {
				t.Fatal(err)
			}
			if account, err := db.UserBySession(ctx, freshRaw, now); err != nil || account.ID != second.ID {
				t.Fatalf("new session unavailable: %+v %v", account, err)
			}
			if _, err := db.UserBySession(ctx, raw, now); !errors.Is(err, store.ErrNotFound) {
				t.Fatalf("old session not revoked: %v", err)
			}
			if kind != "activity" {
				go func() { defer close(done); handler.ServeHTTP(late, stale) }()
				select {
				case <-late.entered:
				case <-time.After(5 * time.Second):
					t.Fatal("401 did not reach response barrier")
				}
			}
			close(late.release)
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("delayed response did not finish")
			}
			wantLate := http.StatusOK
			if kind != "activity" {
				wantLate = http.StatusUnauthorized
			}
			if late.Code != wantLate {
				t.Fatalf("late response status=%d", late.Code)
			}
			jar.SetCookies(origin, late.Result().Cookies()) // Browser receives this response last.
			next := httptest.NewRequest("GET", "http://goclick.test/api/me", nil)
			for _, cookie := range jar.Cookies(origin) {
				next.AddCookie(cookie)
			}
			result := httptest.NewRecorder()
			handler.ServeHTTP(result, next)
			var user publicUserResponse
			decodeResponse(t, result.Result(), &user)
			if result.Code != http.StatusOK || user.ID != second.ID {
				t.Fatalf("late %s response erased new login: status=%d user=%d", kind, result.Code, user.ID)
			}
			if len(late.Result().Cookies()) != 0 {
				t.Fatal("ordinary response wrote a session cookie")
			}
		})
	}
}
