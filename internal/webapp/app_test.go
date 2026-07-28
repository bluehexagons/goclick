package webapp

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bluehexagons/goclick/internal/store"
	"golang.org/x/crypto/bcrypt"
)

func TestAccountClickAndLogoutFlow(t *testing.T) {
	baseURL, client := testServer(t)

	response := jsonRequest(t, client, http.MethodPost, baseURL+"/api/auth/signup", map[string]any{
		"username": "new_player", "email": "player@example.com",
		"password": "password123", "password_confirmation": "password123",
	}, nil)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("signup status = %d, body = %s", response.StatusCode, readBody(t, response))
	}
	if len(response.Cookies()) != 1 || !response.Cookies()[0].HttpOnly {
		t.Fatal("signup did not set an HttpOnly session cookie")
	}
	response.Body.Close()

	response = jsonRequest(t, client, http.MethodGet, baseURL+"/api/me", nil, nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("me status = %d", response.StatusCode)
	}
	var me map[string]any
	decodeResponse(t, response, &me)
	if me["username"] != "new_player" {
		t.Fatalf("me = %#v", me)
	}
	if _, exposed := me["password_hash"]; exposed {
		t.Fatal("password hash exposed in user response")
	}

	response = jsonRequest(t, client, http.MethodGet, baseURL+"/api/clicks", nil, nil)
	var empty entitiesResponse
	decodeResponse(t, response, &empty)
	if empty.ClickCount != nil {
		t.Fatalf("new user's click count = %+v, want nil", empty.ClickCount)
	}

	response = jsonRequest(t, client, http.MethodPost, baseURL+"/api/clicks", nil, nil)
	var clicked entitiesResponse
	decodeResponse(t, response, &clicked)
	if clicked.ClickCount == nil || clicked.ClickCount.Count != 1 ||
		clicked.StreakCounterDay.Count != 1 {
		t.Fatalf("click response = %+v", clicked)
	}

	response = jsonRequest(t, client, http.MethodDelete, baseURL+"/api/auth/logout", nil, nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("logout status = %d", response.StatusCode)
	}
	response.Body.Close()

	response = jsonRequest(t, client, http.MethodGet, baseURL+"/api/me", nil, nil)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("me after logout status = %d, want 401", response.StatusCode)
	}
	response.Body.Close()

	oversized := strings.Repeat("x", maxJSONBody+1)
	request, err := http.NewRequest(http.MethodPost, baseURL+"/api/clicks", strings.NewReader(oversized))
	if err != nil {
		t.Fatal(err)
	}
	response, err = client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized body status = %d, want 413", response.StatusCode)
	}
	response.Body.Close()
}

func TestValidationAndCrossSiteProtection(t *testing.T) {
	baseURL, client := testServer(t)

	response := jsonRequest(t, client, http.MethodPost, baseURL+"/api/auth/signup", map[string]any{
		"username": "x", "password": "short",
	}, nil)
	if response.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("invalid signup status = %d", response.StatusCode)
	}
	response.Body.Close()

	response = jsonRequest(t, client, http.MethodPost, baseURL+"/api/auth/signup", map[string]any{
		"username": "valid_user", "password": "password123",
	}, map[string]string{"Origin": "https://attacker.example"})
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-site signup status = %d, want 403", response.StatusCode)
	}
	response.Body.Close()

	request, err := http.NewRequest(http.MethodPost, baseURL+"/api/auth/login", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	response, err = client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("missing content type status = %d, want 415", response.StatusCode)
	}
	response.Body.Close()
}

func TestConcurrentClicksAreNotLost(t *testing.T) {
	baseURL, client := testServer(t)
	response := jsonRequest(t, client, http.MethodPost, baseURL+"/api/auth/signup", map[string]any{
		"username": "rapid_clicker", "password": "password123",
	}, nil)
	response.Body.Close()

	const clicks = 24
	var wait sync.WaitGroup
	errors := make(chan string, clicks)
	for range clicks {
		wait.Add(1)
		go func() {
			defer wait.Done()
			response := jsonRequestNoFatal(client, http.MethodPost, baseURL+"/api/clicks")
			if response.err != nil {
				errors <- response.err.Error()
				return
			}
			defer response.response.Body.Close()
			if response.response.StatusCode != http.StatusOK {
				errors <- response.response.Status
			}
		}()
	}
	wait.Wait()
	close(errors)
	for err := range errors {
		t.Error(err)
	}

	response = jsonRequest(t, client, http.MethodGet, baseURL+"/api/clicks", nil, nil)
	var counters entitiesResponse
	decodeResponse(t, response, &counters)
	if counters.ClickCount == nil || counters.ClickCount.Count != clicks {
		t.Fatalf("click count = %+v, want %d", counters.ClickCount, clicks)
	}
}

func TestLoginRateLimitAndSecurityHeaders(t *testing.T) {
	baseURL, client := testServer(t)
	for attempt := 1; attempt <= 4; attempt++ {
		response := jsonRequest(t, client, http.MethodPost, baseURL+"/api/auth/login", map[string]any{
			"username": "missing_user", "password": "incorrect",
		}, nil)
		if attempt <= 3 && response.StatusCode != http.StatusUnauthorized {
			t.Fatalf("attempt %d status = %d, want 401", attempt, response.StatusCode)
		}
		if attempt == 4 {
			if response.StatusCode != http.StatusTooManyRequests {
				t.Fatalf("fourth attempt status = %d, want 429", response.StatusCode)
			}
			if response.Header.Get("Retry-After") == "" {
				t.Fatal("rate-limited response omitted Retry-After")
			}
		}
		if response.Header.Get("Content-Security-Policy") == "" {
			t.Fatal("response omitted Content-Security-Policy")
		}
		response.Body.Close()
	}
}

func TestRateLimitRetryAfterRoundsUp(t *testing.T) {
	response := httptest.NewRecorder()
	rateLimited(response, 1500*time.Millisecond)

	if response.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", response.Code)
	}
	if retryAfter := response.Header().Get("Retry-After"); retryAfter != "2" {
		t.Fatalf("Retry-After = %q, want 2", retryAfter)
	}
}

func TestHSTSMatchesSecureCookieMode(t *testing.T) {
	for _, test := range []struct {
		name          string
		secureCookies bool
		wantHSTS      bool
	}{
		{name: "HTTPS", secureCookies: true, wantHSTS: true},
		{name: "plain HTTP", secureCookies: false, wantHSTS: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			database, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()
			app, err := New(database, Config{
				SecureCookies: test.secureCookies,
				Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
				passwordCost:  bcrypt.MinCost,
			})
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodGet, "https://goclick.test/up", nil)
			response := httptest.NewRecorder()
			app.Handler().ServeHTTP(response, request)
			hasHSTS := response.Header().Get("Strict-Transport-Security") != ""
			if hasHSTS != test.wantHSTS {
				t.Fatalf("HSTS present = %v, want %v", hasHSTS, test.wantHSTS)
			}
		})
	}
}

func TestInvalidClickSessionsAreRateLimitedBeforeAuthentication(t *testing.T) {
	database, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	app, err := New(database, Config{
		Logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:          time.Now,
		passwordCost: bcrypt.MinCost,
	})
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{
		Transport: handlerTransport{handler: app.Handler()},
		Timeout:   5 * time.Second,
	}
	baseURL := "http://goclick.test"
	cookieValue := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x42}, 32))

	request, err := http.NewRequest(http.MethodPost, baseURL+"/api/clicks", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Cookie", sessionCookie+"="+cookieValue)
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("first invalid session status = %d, want 401", response.StatusCode)
	}

	for range clicksPerIP - 1 {
		if ok, _ := app.limiter.allow("click-ip:192.0.2.1", clicksPerIP, time.Minute); !ok {
			t.Fatal("click IP bucket filled earlier than expected")
		}
	}
	response, err = client.Do(request.Clone(context.Background()))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("request after full pre-auth bucket status = %d, want 429", response.StatusCode)
	}
}

func TestDummyPasswordHashUsesRailsProductionCost(t *testing.T) {
	database, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	app, err := New(database, Config{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatal(err)
	}
	cost, err := bcrypt.Cost(app.dummyHash)
	if err != nil {
		t.Fatal(err)
	}
	if cost != 12 {
		t.Fatalf("dummy bcrypt cost = %d, want Rails production cost 12", cost)
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{
		Jar:       jar,
		Transport: handlerTransport{handler: app.Handler()},
		Timeout:   5 * time.Second,
	}
	response := jsonRequest(t, client, http.MethodPost, "http://goclick.test/api/auth/signup", map[string]any{
		"username": "cost_test", "password": "password123",
	}, nil)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("signup status = %d, body = %s", response.StatusCode, readBody(t, response))
	}
	response.Body.Close()
	user, err := database.UserByIdentifier(context.Background(), "cost_test")
	if err != nil {
		t.Fatal(err)
	}
	cost, err = bcrypt.Cost([]byte(user.PasswordHash))
	if err != nil {
		t.Fatal(err)
	}
	if cost != 12 {
		t.Fatalf("new-user bcrypt cost = %d, want Rails production cost 12", cost)
	}
}

func TestFrontendIsEmbedded(t *testing.T) {
	baseURL, client := testServer(t)
	response := jsonRequest(t, client, http.MethodGet, baseURL+"/", nil, nil)
	body := readBody(t, response)
	if response.StatusCode != http.StatusOK ||
		!strings.Contains(body, "One button.") ||
		!strings.Contains(body, `id="loading-view"`) ||
		!strings.Contains(body, `id="retry-game-button"`) {
		t.Fatalf("frontend status/body = %d %q", response.StatusCode, body)
	}

	response = jsonRequest(t, client, http.MethodGet, baseURL+"/app.js", nil, nil)
	cacheControl := response.Header.Get("Cache-Control")
	script := readBody(t, response)
	if response.StatusCode != http.StatusOK ||
		cacheControl != "no-cache" ||
		!strings.Contains(script, "handleExpiredSession") ||
		!strings.Contains(script, "maxPendingClicks") {
		t.Fatalf("frontend script status/cache/body = %d %q %q", response.StatusCode, cacheControl, script)
	}
}

func testServer(t *testing.T) (string, *http.Client) {
	t.Helper()
	database, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	app, err := New(database, Config{
		Logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:          time.Now,
		passwordCost: bcrypt.MinCost,
	})
	if err != nil {
		t.Fatal(err)
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return "http://goclick.test", &http.Client{
		Jar:       jar,
		Transport: handlerTransport{handler: app.Handler()},
		Timeout:   5 * time.Second,
	}
}

type handlerTransport struct {
	handler http.Handler
}

func (transport handlerTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	request.RemoteAddr = "192.0.2.1:12345"
	recorder := httptest.NewRecorder()
	transport.handler.ServeHTTP(recorder, request)
	return recorder.Result(), nil
}

func jsonRequest(t *testing.T, client *http.Client, method, url string, body any, headers map[string]string) *http.Response {
	t.Helper()
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(method, url, reader)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

type requestResult struct {
	response *http.Response
	err      error
}

func jsonRequestNoFatal(client *http.Client, method, url string) requestResult {
	request, err := http.NewRequest(method, url, nil)
	if err != nil {
		return requestResult{err: err}
	}
	response, err := client.Do(request)
	return requestResult{response: response, err: err}
}

func decodeResponse(t *testing.T, response *http.Response, target any) {
	t.Helper()
	defer response.Body.Close()
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatal(err)
	}
}

func readBody(t *testing.T, response *http.Response) string {
	t.Helper()
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}
