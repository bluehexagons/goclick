package webapp

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
