package webapp

import (
	"bytes"
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

func TestFrontendIsEmbedded(t *testing.T) {
	baseURL, client := testServer(t)
	response := jsonRequest(t, client, http.MethodGet, baseURL+"/", nil, nil)
	body := readBody(t, response)
	if response.StatusCode != http.StatusOK || !strings.Contains(body, "One button.") {
		t.Fatalf("frontend status/body = %d %q", response.StatusCode, body)
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
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:    time.Now,
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
