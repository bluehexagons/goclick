package webapp

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func frontendTestApp(t *testing.T) *App {
	t.Helper()
	static, err := fs.Sub(webFiles, "web")
	if err != nil {
		t.Fatalf("open embedded frontend: %v", err)
	}
	assets, err := loadPublicAssets(static)
	if err != nil {
		t.Fatal(err)
	}
	return &App{publicAssets: assets}
}

func TestFrontendBrowserCompatibilityAssets(t *testing.T) {
	app := frontendTestApp(t)
	indexResponse := httptest.NewRecorder()
	app.frontend(indexResponse, httptest.NewRequest(http.MethodGet, "/", nil))
	if indexResponse.Code != http.StatusOK {
		t.Fatalf("index status = %d, want %d", indexResponse.Code, http.StatusOK)
	}
	if !strings.Contains(
		indexResponse.Body.String(),
		`pattern="[A-Za-z0-9_\-]+"`,
	) {
		t.Fatal("username pattern does not escape the hyphen for HTML RegExp v mode")
	}

	iconResponse := httptest.NewRecorder()
	app.frontend(
		iconResponse,
		httptest.NewRequest(http.MethodGet, "/favicon.svg", nil),
	)
	if iconResponse.Code != http.StatusOK {
		t.Fatalf("favicon status = %d, want %d", iconResponse.Code, http.StatusOK)
	}
	if contentType := iconResponse.Header().Get("Content-Type"); contentType != "image/svg+xml" {
		t.Fatalf("favicon Content-Type = %q, want %q", contentType, "image/svg+xml")
	}
}

func TestFrontendCannotExposeAdminPageThroughEncodedPaths(t *testing.T) {
	app, _, _, _ := adminTestApp(t)
	handler := app.Handler()
	for _, test := range []struct {
		target string
		status int
	}{
		{"/admin", http.StatusUnauthorized},
		{"/admin.html", http.StatusUnauthorized},
		{"/%61dmin.html", http.StatusUnauthorized},
		{"/%2fadmin.html", http.StatusNotFound},
		{"/x%2f..%2fadmin.html", http.StatusNotFound},
		{"/%2e/admin.html", http.StatusNotFound},
	} {
		t.Run(test.target, func(t *testing.T) {
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, httptest.NewRequest(method, test.target, nil))
				if response.Code != test.status {
					t.Fatalf("%s status = %d, want %d", method, response.Code, test.status)
				}
			}
		})
	}
}

func TestFrontendOnlyServesPublicAssets(t *testing.T) {
	app := frontendTestApp(t)
	for _, target := range []string{
		"/", "/index.html", "/app.js", "/app.css",
		"/admin.js", "/admin.css", "/favicon.svg", "/icons.svg", "/achievement-icons.svg", "/language-flags.svg",
		"/button-material.svg", "/button-glow.svg", "/background-grain.svg",
	} {
		response := httptest.NewRecorder()
		app.frontend(response, httptest.NewRequest(http.MethodGet, target, nil))
		if response.Code != http.StatusOK {
			t.Fatalf("public asset %s returned %d", target, response.Code)
		}
	}
	for _, target := range []string{"/admin.html", "/missing.js"} {
		response := httptest.NewRecorder()
		app.frontend(response, httptest.NewRequest(http.MethodGet, target, nil))
		if response.Code != http.StatusNotFound {
			t.Fatalf("non-public asset %s returned %d", target, response.Code)
		}
	}
}

func TestFrontendRevalidatesUnchangedAssets(t *testing.T) {
	app := frontendTestApp(t)
	for _, name := range []string{"/", "/app.js", "/app.css"} {
		initial := httptest.NewRecorder()
		app.frontend(initial, httptest.NewRequest(http.MethodGet, name, nil))
		etag := initial.Header().Get("ETag")
		if initial.Code != http.StatusOK || etag == "" || initial.Body.Len() == 0 {
			t.Fatalf("first request for %s returned %d with ETag %q", name, initial.Code, etag)
		}
		conditional := httptest.NewRequest(http.MethodGet, name, nil)
		conditional.Header.Set("If-None-Match", etag)
		cached := httptest.NewRecorder()
		app.frontend(cached, conditional)
		if cached.Code != http.StatusNotModified || cached.Body.Len() != 0 || cached.Header().Get("Cache-Control") != "no-cache" {
			t.Fatalf("unchanged %s returned %d with %d bytes and cache control %q", name, cached.Code, cached.Body.Len(), cached.Header().Get("Cache-Control"))
		}
		conditional.Header.Set("If-None-Match", `"old-content"`)
		changed := httptest.NewRecorder()
		app.frontend(changed, conditional)
		if changed.Code != http.StatusOK || changed.Body.String() != initial.Body.String() {
			t.Fatalf("changed %s returned %d with %d bytes", name, changed.Code, changed.Body.Len())
		}
	}
}

func TestPublicAssetsDoNotExhaustAccountOrHealthBudget(t *testing.T) {
	app, _, _, _ := adminTestApp(t)
	handler := app.Handler()
	get := func(method, target string) int {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(method, target, nil))
		return response.Code
	}
	for i := 0; i < 600; i++ {
		if status := get(http.MethodHead, "/app.js"); status != http.StatusOK {
			t.Fatalf("asset %d returned %d", i+1, status)
		}
	}
	if status := get(http.MethodGet, "/"); status != http.StatusTooManyRequests {
		t.Fatalf("exhausted asset budget returned %d", status)
	}
	if status := get(http.MethodGet, "/api/game"); status != http.StatusUnauthorized {
		t.Fatalf("account endpoint was throttled by asset traffic: %d", status)
	}
	if status := get(http.MethodGet, "/up"); status != http.StatusOK {
		t.Fatalf("health check was throttled by asset traffic: %d", status)
	}
}
