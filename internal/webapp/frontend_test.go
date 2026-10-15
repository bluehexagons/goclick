package webapp

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestFrontendBrowserCompatibilityAssets(t *testing.T) {
	static, err := fs.Sub(webFiles, "web")
	if err != nil {
		t.Fatalf("open embedded frontend: %v", err)
	}
	app := &App{static: static}

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
	static, err := fs.Sub(webFiles, "web")
	if err != nil {
		t.Fatal(err)
	}
	app := &App{static: static}
	for _, target := range []string{
		"/", "/index.html", "/app.js", "/app.css", "/button.js", "/button-3d.js",
		"/preferences.js", "/local-game.js", "/click-feedback.js",
		"/admin.js", "/admin.css", "/favicon.svg", "/icons.svg",
	} {
		response := httptest.NewRecorder()
		app.frontend(response, httptest.NewRequest(http.MethodGet, target, nil))
		if response.Code != http.StatusOK {
			t.Fatalf("public asset %s returned %d", target, response.Code)
		}
	}
	app.static = fstest.MapFS{"private.txt": {Data: []byte("private embedded content")}}
	response := httptest.NewRecorder()
	app.frontend(response, httptest.NewRequest(http.MethodGet, "/private.txt", nil))
	if response.Code != http.StatusNotFound || strings.Contains(response.Body.String(), "private embedded content") {
		t.Fatal("new embedded files must not be automatically exposed")
	}
}
