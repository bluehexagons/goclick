package webapp

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"
)

type pausedBody struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (b *pausedBody) Read([]byte) (int, error) {
	b.once.Do(func() { close(b.started) })
	<-b.release
	return 0, io.EOF
}

func awaitResponse(t *testing.T, result <-chan *httptest.ResponseRecorder) *httptest.ResponseRecorder {
	t.Helper()
	select {
	case response := <-result:
		return response
	case <-time.After(2 * time.Second):
		t.Fatal("request blocked behind an incomplete body")
		return nil
	}
}

func serveAsync(handler http.Handler, request *http.Request) <-chan *httptest.ResponseRecorder {
	result := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		result <- response
	}()
	return result
}

func TestAnonymousRecoveryCannotQueueExclusiveAccess(t *testing.T) {
	app, _, _, _ := adminTestApp(t)
	handler := app.Handler()
	body := &pausedBody{started: make(chan struct{}), release: make(chan struct{})}
	request := httptest.NewRequest("POST", "/api/auth/login", body)
	request.Header.Set("Content-Type", "application/json")
	login := serveAsync(handler, request)
	defer func() { close(body.release); awaitResponse(t, login) }()
	<-body.started
	response := awaitResponse(t, serveAsync(handler, httptest.NewRequest("POST", "/api/admin/backups/restore", nil)))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("restore status = %d", response.Code)
	}
	response = awaitResponse(t, serveAsync(handler, httptest.NewRequest("GET", "/up", nil)))
	if response.Code != http.StatusOK {
		t.Fatalf("health status = %d", response.Code)
	}
}

func TestRecoveryUploadAllowsRequestsAndRechecksRevokedSession(t *testing.T) {
	app, db, client, id := adminTestApp(t)
	handler := app.Handler()
	var payload bytes.Buffer
	writer := multipart.NewWriter(&payload)
	if err := writer.WriteField("password", "password123"); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("confirmation", "RESTORE"); err != nil {
		t.Fatal(err)
	}
	part, err := writer.CreateFormFile("backup", "snapshot.db")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("unused because access is revoked")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	body := &pausedBody{started: make(chan struct{}), release: make(chan struct{})}
	request := httptest.NewRequest("POST", "http://goclick.test/api/admin/backups/restore", io.MultiReader(&payload, body))
	request.Header.Set("Content-Type", writer.FormDataContentType())
	origin, _ := url.Parse("http://goclick.test")
	for _, cookie := range client.Jar.Cookies(origin) {
		request.AddCookie(cookie)
	}
	result := serveAsync(handler, request)
	released := false
	defer func() {
		if !released {
			close(body.release)
			awaitResponse(t, result)
		}
	}()
	<-body.started
	response := awaitResponse(t, serveAsync(handler, httptest.NewRequest("GET", "/up", nil)))
	if response.Code != http.StatusOK {
		t.Fatalf("upload blocked health: %d", response.Code)
	}
	if err := db.SetPassword(context.Background(), id, "replacement-password", time.Now()); err != nil {
		t.Fatal(err)
	}
	close(body.release)
	released = true
	response = awaitResponse(t, result)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("revoked upload status = %d: %s", response.Code, response.Body.String())
	}
	files, err := os.ReadDir(app.backupDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 0 {
		t.Fatal("revoked upload created a recovery snapshot")
	}
}
