package webapp

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/mail"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/bluehexagons/goclick/internal/store"
	"golang.org/x/crypto/bcrypt"
)

const (
	sessionCookie    = "goclick_session"
	maxJSONBody      = 8 << 10
	passwordHashCost = 12
	clicksPerIP      = 360
)

var (
	usernamePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{3,32}$`)
	//go:embed web/*
	webFiles embed.FS
)

type Config struct {
	SecureCookies bool
	TrustProxy    bool
	SessionTTL    time.Duration
	Logger        *slog.Logger
	Now           func() time.Time
	passwordCost  int
}

type App struct {
	store         *store.Store
	secureCookies bool
	trustProxy    bool
	sessionTTL    time.Duration
	passwordCost  int
	logger        *slog.Logger
	now           func() time.Time
	limiter       *limiter
	dummyHash     []byte
	static        fs.FS
}

type contextKey int

const userContextKey contextKey = 1

func New(database *store.Store, config Config) (*App, error) {
	if database == nil {
		return nil, errors.New("store is required")
	}
	if config.SessionTTL <= 0 {
		config.SessionTTL = 180 * 24 * time.Hour
	}
	if config.Logger == nil {
		config.Logger = slog.Default()
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	if config.passwordCost == 0 {
		config.passwordCost = passwordHashCost
	}
	dummyHash, err := bcrypt.GenerateFromPassword([]byte("constant dummy password"), config.passwordCost)
	if err != nil {
		return nil, fmt.Errorf("prepare password verifier: %w", err)
	}
	static, err := fs.Sub(webFiles, "web")
	if err != nil {
		return nil, fmt.Errorf("open embedded frontend: %w", err)
	}

	app := &App{
		store:         database,
		secureCookies: config.SecureCookies,
		trustProxy:    config.TrustProxy,
		sessionTTL:    config.SessionTTL,
		passwordCost:  config.passwordCost,
		logger:        config.Logger,
		now:           config.Now,
		dummyHash:     dummyHash,
		static:        static,
	}
	app.limiter = newLimiter(config.Now)
	return app, nil
}

func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /up", a.health)
	mux.HandleFunc("POST /api/auth/signup", a.signup)
	mux.HandleFunc("POST /api/auth/login", a.login)
	mux.HandleFunc("DELETE /api/auth/logout", a.logout)
	mux.HandleFunc("GET /api/me", a.requireUser(a.me))
	mux.HandleFunc("GET /api/clicks", a.requireUser(a.current))
	mux.HandleFunc("POST /api/clicks", a.requireUser(a.increment))

	// Compatibility aliases make the transition from the Rails API less abrupt.
	mux.HandleFunc("POST /auth/signup", a.signup)
	mux.HandleFunc("POST /auth/login", a.login)
	mux.HandleFunc("DELETE /auth/logout", a.logout)
	mux.HandleFunc("GET /me", a.requireUser(a.me))
	mux.HandleFunc("GET /entities/current", a.requireUser(a.current))
	mux.HandleFunc("POST /entities/increment", a.requireUser(a.increment))

	mux.HandleFunc("GET /", a.frontend)
	return a.securityHeaders(a.recoverPanic(a.rejectCrossSite(a.bodyLimit(a.globalLimit(mux)))))
}

func (a *App) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := a.store.Health(ctx); err != nil {
		a.logger.Warn("health check failed", "error", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type signupPayload struct {
	Username             string `json:"username"`
	Email                string `json:"email"`
	Password             string `json:"password"`
	PasswordConfirmation string `json:"password_confirmation"`
	User                 *struct {
		Username             string `json:"username"`
		Email                string `json:"email"`
		Password             string `json:"password"`
		PasswordConfirmation string `json:"password_confirmation"`
	} `json:"user"`
}

func (a *App) signup(w http.ResponseWriter, r *http.Request) {
	if ok, retry := a.limiter.allow("signup:"+a.clientIP(r), 5, time.Minute); !ok {
		rateLimited(w, retry)
		return
	}
	var payload signupPayload
	if !decodeJSON(w, r, &payload) {
		return
	}
	if payload.User != nil {
		payload.Username = payload.User.Username
		payload.Email = payload.User.Email
		payload.Password = payload.User.Password
		payload.PasswordConfirmation = payload.User.PasswordConfirmation
	}
	payload.Username = strings.TrimSpace(payload.Username)
	payload.Email = strings.TrimSpace(payload.Email)

	var validation []string
	if !usernamePattern.MatchString(payload.Username) {
		validation = append(validation, "Username must be 3–32 characters using letters, numbers, underscores, or dashes")
	}
	if len(payload.Password) < 8 || len([]byte(payload.Password)) > 72 {
		validation = append(validation, "Password must be 8–72 bytes")
	}
	if payload.PasswordConfirmation != "" && payload.Password != payload.PasswordConfirmation {
		validation = append(validation, "Passwords do not match")
	}
	var email *string
	if payload.Email != "" {
		address, err := mail.ParseAddress(payload.Email)
		if err != nil || address.Address != payload.Email || len(payload.Email) > 254 {
			validation = append(validation, "Email is not valid")
		} else {
			email = &payload.Email
		}
	}
	if len(validation) > 0 {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"errors": validation})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(payload.Password), a.passwordCost)
	if err != nil {
		a.internalError(w, r, "hash signup password", err)
		return
	}
	user, err := a.store.CreateUser(r.Context(), payload.Username, email, string(hash), a.now())
	if errors.Is(err, store.ErrConflict) {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"errors": []string{"Username or email is already in use"}})
		return
	}
	if err != nil {
		a.internalError(w, r, "create signup user", err)
		return
	}
	if err := a.startSession(w, r, user); err != nil {
		a.internalError(w, r, "start signup session", err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"user": publicUser(user)})
}

type loginPayload struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (a *App) login(w http.ResponseWriter, r *http.Request) {
	ip := a.clientIP(r)
	if ok, retry := a.limiter.allow("login-ip:"+ip, 5, 20*time.Second); !ok {
		rateLimited(w, retry)
		return
	}
	var payload loginPayload
	if !decodeJSON(w, r, &payload) {
		return
	}
	identifier := strings.TrimSpace(payload.Username)
	if identifier == "" {
		identifier = strings.TrimSpace(payload.Email)
	}
	if len(identifier) > 254 || len(payload.Password) > 1024 {
		invalidCredentials(w)
		return
	}
	if ok, retry := a.limiter.allow("login-id:"+strings.ToLower(identifier), 3, time.Minute); !ok {
		rateLimited(w, retry)
		return
	}

	user, err := a.store.UserByIdentifier(r.Context(), identifier)
	hash := a.dummyHash
	if err == nil {
		hash = []byte(user.PasswordHash)
	} else if !errors.Is(err, store.ErrNotFound) {
		a.internalError(w, r, "find login user", err)
		return
	}
	passwordOK := bcrypt.CompareHashAndPassword(hash, []byte(payload.Password)) == nil
	if err != nil || !passwordOK {
		invalidCredentials(w)
		return
	}
	if raw, _, ok := rawSessionToken(r); ok {
		_ = a.store.DeleteSession(r.Context(), raw)
	}
	if err := a.startSession(w, r, user); err != nil {
		a.internalError(w, r, "start login session", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": publicUser(user)})
}

func invalidCredentials(w http.ResponseWriter) {
	writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid username or password"})
}

func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	if raw, _, ok := rawSessionToken(r); ok {
		if err := a.store.DeleteSession(r.Context(), raw); err != nil {
			a.internalError(w, r, "delete logout session", err)
			return
		}
	}
	a.clearSessionCookie(w)
	writeJSON(w, http.StatusOK, map[string]string{"message": "Logged out successfully"})
}

func (a *App) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, publicUser(userFromContext(r.Context())))
}

func (a *App) current(w http.ResponseWriter, r *http.Request) {
	counters, err := a.store.CurrentCounters(r.Context(), userFromContext(r.Context()).ID)
	if err != nil {
		a.internalError(w, r, "read counters", err)
		return
	}
	writeJSON(w, http.StatusOK, entityResponse(counters))
}

func (a *App) increment(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	if ok, retry := a.limiter.allow("click:"+strconv.FormatInt(user.ID, 10), 320, time.Minute); !ok {
		rateLimited(w, retry)
		return
	}
	counters, err := a.store.Increment(r.Context(), user.ID, a.now())
	if err != nil {
		a.internalError(w, r, "increment counters", err)
		return
	}
	writeJSON(w, http.StatusOK, entityResponse(counters))
}

type publicUserResponse struct {
	ID        int64   `json:"id"`
	Username  string  `json:"username"`
	Email     *string `json:"email"`
	Admin     bool    `json:"admin"`
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
}

func publicUser(user store.User) publicUserResponse {
	return publicUserResponse{
		ID: user.ID, Username: user.Username, Email: user.Email, Admin: user.Admin,
		CreatedAt: user.CreatedAt.Format(time.RFC3339Nano),
		UpdatedAt: user.UpdatedAt.Format(time.RFC3339Nano),
	}
}

type entity struct {
	Count        int64   `json:"count"`
	ModifiedTime *string `json:"modified_time"`
}

type entitiesResponse struct {
	ClickCount         *entity `json:"click_count"`
	StreakCounterDay   *entity `json:"streak_counter_day"`
	StreakCounterMonth *entity `json:"streak_counter_month"`
	StreakCounterYear  *entity `json:"streak_counter_year"`
}

func entityResponse(counters store.Counters) entitiesResponse {
	if !counters.Exists {
		return entitiesResponse{}
	}
	var modified *string
	if counters.LastClickedAt != nil {
		value := counters.LastClickedAt.Format(time.RFC3339Nano)
		modified = &value
	}
	return entitiesResponse{
		ClickCount:         &entity{Count: counters.Clicks, ModifiedTime: modified},
		StreakCounterDay:   &entity{Count: counters.DayStreak, ModifiedTime: modified},
		StreakCounterMonth: &entity{Count: counters.MonthStreak, ModifiedTime: modified},
		StreakCounterYear:  &entity{Count: counters.YearStreak, ModifiedTime: modified},
	}
}

func (a *App) startSession(w http.ResponseWriter, r *http.Request, user store.User) error {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return fmt.Errorf("generate session token: %w", err)
	}
	now := a.now()
	expires := now.Add(a.sessionTTL)
	if err := a.store.CreateSession(r.Context(), raw, user.ID, expires, now); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: base64.RawURLEncoding.EncodeToString(raw),
		Path: "/", Expires: expires, MaxAge: int(a.sessionTTL.Seconds()),
		HttpOnly: true, Secure: a.secureCookies, SameSite: http.SameSiteStrictMode,
	})
	return nil
}

func (a *App) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: a.secureCookies, SameSite: http.SameSiteStrictMode,
	})
}

func (a *App) requireUser(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw, present, valid := rawSessionToken(r)
		if !present {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Authentication required"})
			return
		}
		if !valid {
			a.clearSessionCookie(w)
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid session"})
			return
		}
		user, err := a.store.UserBySession(r.Context(), raw, a.now())
		if errors.Is(err, store.ErrNotFound) {
			a.clearSessionCookie(w)
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid or expired session"})
			return
		}
		if err != nil {
			a.internalError(w, r, "authenticate session", err)
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), userContextKey, user)))
	}
}

func rawSessionToken(r *http.Request) ([]byte, bool, bool) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil {
		return nil, false, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(cookie.Value)
	if err != nil || len(raw) != 32 {
		return nil, true, false
	}
	return raw, true, true
}

func userFromContext(ctx context.Context) store.User {
	user, _ := ctx.Value(userContextKey).(store.User)
	return user
}

func (a *App) globalLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost &&
			(r.URL.Path == "/api/clicks" || r.URL.Path == "/entities/increment") {
			if ok, retry := a.limiter.allow("click-ip:"+a.clientIP(r), clicksPerIP, time.Minute); !ok {
				rateLimited(w, retry)
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		if ok, retry := a.limiter.allow("request:"+a.clientIP(r), 200, 5*time.Minute); !ok {
			rateLimited(w, retry)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *App) bodyLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
			if r.ContentLength > maxJSONBody {
				writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "Request body is too large"})
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
		}
		next.ServeHTTP(w, r)
	})
}

func (a *App) rejectCrossSite(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		if strings.EqualFold(r.Header.Get("Sec-Fetch-Site"), "cross-site") {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Cross-site request rejected"})
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			parsed, err := url.Parse(origin)
			if err != nil || !sameHost(parsed.Host, r.Host) {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "Origin does not match request host"})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func sameHost(first, second string) bool {
	return strings.EqualFold(strings.TrimSuffix(first, "."), strings.TrimSuffix(second, "."))
}

func (a *App) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		if a.secureCookies {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}

func (a *App) recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				a.logger.Error("request panic", "method", r.Method, "path", r.URL.Path, "panic", recovered)
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (a *App) frontend(w http.ResponseWriter, r *http.Request) {
	requested := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if requested == "." || requested == "" {
		requested = "index.html"
	}
	content, err := fs.ReadFile(a.static, requested)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if contentType := mime.TypeByExtension(path.Ext(requested)); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	// Asset filenames are intentionally stable, so revalidate them on each page
	// load to avoid pairing new markup with stale JavaScript after a deployment.
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	if mediaType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])); mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Content-Type must be application/json"})
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "Request body is too large"})
		} else {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Request body must be valid JSON"})
		}
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Request body must contain one JSON object"})
		return false
	}
	return true
}

func (a *App) clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer := net.ParseIP(host)
	if a.trustProxy && peer != nil && peer.IsLoopback() {
		forwarded := net.ParseIP(strings.TrimSpace(r.Header.Get("X-Real-IP")))
		if forwarded != nil {
			return forwarded.String()
		}
	}
	return host
}

func rateLimited(w http.ResponseWriter, retry time.Duration) {
	seconds := retry / time.Second
	if retry%time.Second != 0 {
		seconds++
	}
	if seconds < 1 {
		seconds = 1
	}
	w.Header().Set("Retry-After", strconv.FormatInt(int64(seconds), 10))
	writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Too many requests; try again shortly"})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func (a *App) internalError(w http.ResponseWriter, r *http.Request, message string, err error) {
	a.logger.Error(message, "method", r.Method, "path", r.URL.Path, "error", err)
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
}
