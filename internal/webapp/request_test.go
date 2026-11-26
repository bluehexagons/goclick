package webapp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestClickRejectsReplacedAccountBeforeConsumingAccountBudget(t *testing.T) {
	app, db, client, originalID := adminTestApp(t)
	app.clicksPerMinute = 1
	response := jsonRequest(t, client, "POST", "http://goclick.test/api/auth/signup", map[string]string{
		"username": "replacement_player", "password": "password123",
	}, nil)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("replacement signup = %d: %s", response.StatusCode, readBody(t, response))
	}
	var replacement struct{ User publicUserResponse }
	decodeResponse(t, response, &replacement)
	response = jsonRequest(t, client, "POST", "http://goclick.test/api/clicks", nil, map[string]string{
		"X-GoClick-User-ID": strconv.FormatInt(originalID, 10),
	})
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("stale account click = %d: %s", response.StatusCode, readBody(t, response))
	}
	var conflict map[string]string
	decodeResponse(t, response, &conflict)
	if conflict["code"] != "account_changed" {
		t.Fatalf("conflict = %v", conflict)
	}
	for _, invalid := range []string{"0", "-1", "01", "1.0", "9223372036854775808"} {
		response = jsonRequest(t, client, "POST", "http://goclick.test/api/clicks", nil, map[string]string{"X-GoClick-User-ID": invalid})
		if response.StatusCode != http.StatusBadRequest {
			t.Fatalf("invalid account %q = %d", invalid, response.StatusCode)
		}
		response.Body.Close()
	}
	for _, id := range []int64{originalID, replacement.User.ID} {
		counters, err := db.CurrentCounters(context.Background(), id)
		if err != nil || counters.Exists {
			t.Fatalf("rejected clicks changed account %d: %+v, %v", id, counters, err)
		}
	}
	response = jsonRequest(t, client, "POST", "http://goclick.test/api/clicks", nil, map[string]string{
		"X-GoClick-User-ID": strconv.FormatInt(replacement.User.ID, 10),
	})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("matching account click = %d: %s", response.StatusCode, readBody(t, response))
	}
	var clicked entitiesResponse
	decodeResponse(t, response, &clicked)
	if clicked.ClickCount == nil || clicked.ClickCount.Count != 1 {
		t.Fatalf("matching account counters = %+v", clicked)
	}
	// Existing API clients can still use the session without the optional header.
	response = jsonRequest(t, client, "POST", "http://goclick.test/api/auth/login", map[string]string{
		"username": "test_admin", "password": "password123",
	}, nil)
	if response.StatusCode != http.StatusOK {
		t.Fatal("could not return to original account")
	}
	response.Body.Close()
	response = jsonRequest(t, client, "POST", "http://goclick.test/api/clicks", nil, nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("click without header = %d: %s", response.StatusCode, readBody(t, response))
	}
	response.Body.Close()
}

func TestCrossOriginProtection(t *testing.T) {
	app := &App{}
	handler := app.rejectCrossSite(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	for _, test := range []struct {
		name, method, site, origin string
		want                       int
	}{
		{"non-browser", "POST", "", "", 204},
		{"same origin", "POST", "same-origin", "https://goclick.test", 204},
		{"origin fallback", "POST", "", "https://goclick.test", 204},
		{"cross site", "POST", "cross-site", "https://attacker.test", 403},
		{"same-site sibling", "POST", "same-site", "https://sibling.goclick.test", 403},
		{"cross scheme", "POST", "same-site", "http://goclick.test", 403},
		{"opaque origin", "POST", "", "null", 403},
		{"different port", "POST", "", "https://goclick.test:8443", 403},
		{"safe method", "GET", "cross-site", "https://attacker.test", 204},
		{"logout mutation", "DELETE", "same-site", "https://sibling.goclick.test", 403},
	} {
		t.Run(test.name, func(t *testing.T) {
			r := httptest.NewRequest(test.method, "https://goclick.test/api/auth/login", nil)
			r.Header.Set("Sec-Fetch-Site", test.site)
			r.Header.Set("Origin", test.origin)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != test.want {
				t.Fatalf("status = %d, want %d", w.Code, test.want)
			}
			if w.Code == http.StatusForbidden && w.Header().Get("Content-Type") != "application/json" {
				t.Fatal("CSRF denial lost JSON error format")
			}
		})
	}
}

func TestDecodeJSONRequiresOneBoundedObject(t *testing.T) {
	for _, test := range []struct {
		name, body, contentType string
		want                    int
	}{
		{"valid", `{"username":"player"}`, "application/json; charset=utf-8", 200},
		{"null", `null`, "application/json", 400},
		{"array", `[]`, "application/json", 400},
		{"empty", ``, "application/json", 400},
		{"unknown field", `{"admin":true}`, "application/json", 400},
		{"multiple objects", `{} {}`, "application/json", 400},
		{"trailing null", `{} null`, "application/json", 400},
		{"malformed", `{"username":`, "application/json", 400},
		{"malformed content type", `{}`, "application/json; broken", 415},
		{"oversized chunked", `{"username":"` + strings.Repeat("x", maxJSONBody) + `"}`, "application/json", 413},
		{"oversized trailing whitespace", `{}` + strings.Repeat(" ", maxJSONBody), "application/json", 413},
	} {
		t.Run(test.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(test.body))
			r.ContentLength = -1
			r.Header.Set("Content-Type", test.contentType)
			w := httptest.NewRecorder()
			var payload loginPayload
			ok := decodeJSON(w, r, &payload)
			if ok != (test.want == 200) || w.Code != test.want {
				t.Fatalf("decoded = %v, status = %d, want %d", ok, w.Code, test.want)
			}
		})
	}
}

func TestSigningInRotatesPreviousSession(t *testing.T) {
	baseURL, client := testServer(t)
	response := jsonRequest(t, client, "POST", baseURL+"/api/auth/signup", map[string]string{
		"username": "rotate_user", "password": "password123",
	}, nil)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("signup status = %d", response.StatusCode)
	}
	oldCookie := response.Cookies()[0]
	response.Body.Close()
	response = jsonRequest(t, client, "POST", baseURL+"/api/auth/login", map[string]string{
		"username": "rotate_user", "password": "password123",
	}, nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d", response.StatusCode)
	}
	response.Body.Close()
	r := httptest.NewRequest("GET", baseURL+"/api/me", nil)
	r.AddCookie(oldCookie)
	w, err := client.Transport.RoundTrip(r)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Body.Close()
	if w.StatusCode != http.StatusUnauthorized {
		t.Fatalf("previous session status = %d, want 401", w.StatusCode)
	}
	response = jsonRequest(t, client, "GET", baseURL+"/api/me", nil, nil)
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("new session status = %d, want 200", response.StatusCode)
	}
}

func TestButtonAchievementsRequireTheDisplayedAccount(t *testing.T) {
	_, db, client, id := adminTestApp(t)
	accountID := strconv.FormatInt(id, 10)
	const base = "http://goclick.test/api"
	for _, test := range []struct {
		expected, interaction string
		status                int
	}{
		{"", "reconnect", http.StatusBadRequest},
		{strconv.FormatInt(id+1, 10), "reconnect", http.StatusConflict},
		{accountID, "unknown", http.StatusBadRequest},
		{accountID, "reconnect", http.StatusOK},
		{accountID, "reset", http.StatusOK},
	} {
		response := jsonRequest(t, client, "POST", base+"/button-achievements",
			map[string]string{"interaction": test.interaction}, map[string]string{"X-GoClick-User-ID": test.expected})
		if response.StatusCode != test.status {
			t.Fatalf("record %q with expected ID %q: %d: %s", test.interaction, test.expected, response.StatusCode, readBody(t, response))
		}
		response.Body.Close()
	}
	state, err := db.CurrentCounters(context.Background(), id)
	if err != nil || state.Exists || state.ButtonAchievements != 5 {
		t.Fatalf("hardware-only progress = %+v, %v", state, err)
	}
	response := jsonRequest(t, client, "POST", base+"/clicks", nil,
		map[string]string{"X-GoClick-User-ID": accountID, "X-GoClick-Cord-Slack": "1"})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("slack-cord click = %d: %s", response.StatusCode, readBody(t, response))
	}
	var clicked entitiesResponse
	decodeResponse(t, response, &clicked)
	if clicked.ButtonAchievements != 7 || clicked.ClickCount == nil || clicked.ClickCount.Count != 1 {
		t.Fatalf("saved slack-cord click = %+v", clicked)
	}
	for _, mask := range []string{"1", "4", "64", "128", "256", "invalid"} {
		response := jsonRequest(t, client, "POST", base+"/clicks", nil,
			map[string]string{"X-GoClick-User-ID": accountID, "X-GoClick-Button-Achievements": mask})
		if response.StatusCode != http.StatusBadRequest {
			t.Fatalf("click with mask %q = %d: %s", mask, response.StatusCode, readBody(t, response))
		}
		response.Body.Close()
	}
	response = jsonRequest(t, client, "POST", base+"/clicks", nil,
		map[string]string{"X-GoClick-User-ID": accountID, "X-GoClick-Button-Achievements": "56"})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("click with gestures = %d: %s", response.StatusCode, readBody(t, response))
	}
	decodeResponse(t, response, &clicked)
	if clicked.ButtonAchievements != 63 || clicked.ClickCount == nil || clicked.ClickCount.Count != 2 {
		t.Fatalf("saved click with gestures = %+v", clicked)
	}
	for _, socket := range []string{"middle", "top", "top", "bottom"} {
		response := jsonRequest(t, client, "POST", base+"/button-achievements",
			map[string]string{"interaction": "reconnect", "socket": socket},
			map[string]string{"X-GoClick-User-ID": accountID})
		want := http.StatusOK
		if socket == "middle" {
			want = http.StatusBadRequest
		}
		if response.StatusCode != want {
			t.Fatalf("reconnect to %q = %d: %s", socket, response.StatusCode, readBody(t, response))
		}
		response.Body.Close()
	}
	state, err = db.CurrentCounters(context.Background(), id)
	if err != nil || state.Clicks != 2 || state.ButtonAchievements != 255 {
		t.Fatalf("socket visits = %+v, %v", state, err)
	}
}
