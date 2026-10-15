package webapp

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func holdPasswordBudget(t *testing.T, app *App) func() {
	t.Helper()
	for range cap(app.passwordSlots) {
		if !app.acquirePasswordSlot(httptest.NewRecorder(), httptest.NewRequest("POST", "/", nil)) {
			t.Fatal("could not reserve password budget")
		}
	}
	var once sync.Once
	release := func() {
		once.Do(func() {
			for range cap(app.passwordSlots) {
				app.releasePasswordSlot()
			}
		})
	}
	t.Cleanup(release)
	return release
}

func TestPasswordBudgetRejectsDistributedRequestsWithoutBlockingGameplay(t *testing.T) {
	app, db, client, _ := adminTestApp(t)
	release := holdPasswordBudget(t, app)
	handler := app.Handler()
	var requests sync.WaitGroup
	for i := range 20 {
		requests.Go(func() {
			paths := []string{"/api/auth/signup", "/auth/signup", "/api/auth/login", "/auth/login"}
			body := fmt.Sprintf(`{"username":"overload_%d","password":"password123"}`, i)
			request := httptest.NewRequest("POST", paths[i%len(paths)], strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			request.RemoteAddr = fmt.Sprintf("192.0.2.%d:1234", i+1)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusServiceUnavailable || response.Header().Get("Retry-After") != "1" ||
				!strings.Contains(response.Body.String(), `"code":"authentication_busy"`) || len(response.Result().Cookies()) != 0 {
				t.Errorf("overloaded request %d: status=%d body=%s", i, response.Code, response.Body.String())
			}
		})
	}
	requests.Wait()
	for _, test := range []struct{ method, path string }{
		{"GET", "/up"}, {"GET", "/api/me"}, {"POST", "/api/clicks"},
	} {
		response := jsonRequest(t, client, test.method, "http://goclick.test"+test.path, nil, nil)
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("password saturation blocked %s: %d", test.path, response.StatusCode)
		}
	}
	response := jsonRequest(t, client, "POST", "http://goclick.test/api/admin/backups/export", map[string]string{"password": "password123"}, nil)
	response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("admin password check bypassed shared budget: %d", response.StatusCode)
	}
	stats, err := db.AdminOverview(context.Background(), time.Now())
	if err != nil || stats.Players != 1 || stats.ActiveSessions != 1 {
		t.Fatalf("saturated requests created accounts or sessions: %+v, %v", stats, err)
	}

	release()
	response = jsonRequest(t, client, "POST", "http://goclick.test/api/auth/login", map[string]string{"username": "test_admin", "password": "wrong-password"}, nil)
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong password status = %d", response.StatusCode)
	}
	response = jsonRequest(t, client, "POST", "http://goclick.test/api/auth/login", map[string]string{"username": "test_admin", "password": "password123"}, nil)
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("login did not recover after capacity was released: %d", response.StatusCode)
	}
	response = jsonRequest(t, client, "POST", "http://goclick.test/api/auth/signup", map[string]string{"username": "capacity_recovered", "password": "password123"}, nil)
	response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("signup did not recover after capacity was released: %d", response.StatusCode)
	}
	if len(app.passwordSlots) != 0 {
		t.Fatal("password work leaked capacity after success or failure")
	}
}

func TestPasswordBudgetConfigurationAndCancellation(t *testing.T) {
	_, db, _, _ := adminTestApp(t)
	for _, concurrency := range []int{-1, 0, 1, 3, 64, 65} {
		app, err := New(db, Config{PasswordConcurrency: concurrency, passwordCost: bcrypt.MinCost, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
		if concurrency < 0 || concurrency > 64 {
			if err == nil {
				t.Fatalf("accepted invalid concurrency %d", concurrency)
			}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		if concurrency == 0 {
			if capacity := cap(app.passwordSlots); capacity < 1 || capacity > 4 {
				t.Fatalf("automatic capacity = %d", capacity)
			}
		} else if cap(app.passwordSlots) != concurrency {
			t.Fatalf("capacity = %d, want %d", cap(app.passwordSlots), concurrency)
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		request := httptest.NewRequest("POST", "/", nil).WithContext(ctx)
		response := httptest.NewRecorder()
		if app.acquirePasswordSlot(response, request) || len(app.passwordSlots) != 0 {
			t.Fatal("cancelled request consumed password capacity")
		}
	}
}
