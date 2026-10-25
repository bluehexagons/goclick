package webapp

import (
	"bytes"
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
	"path"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/bluehexagons/goclick/internal/store"
	"golang.org/x/crypto/bcrypt"
)

const (
	sessionCookie      = "goclick_session"
	maxJSONBody        = 8 << 10
	passwordHashCost   = 12
	defaultClicksPerIP = 360
	// This is a bcrypt hash of a fixed, non-secret dummy password. Unknown
	// users are rejected regardless of the comparison result, so storing the
	// hash avoids a cost-12 bcrypt operation on every production startup.
	productionDummyHash = "$2b$12$GQHDE/67Qc3HR8.tCq1D6.o3tN/3nCuCaxgKzXbo3uMAoAu.jzuiO"
)

var (
	usernamePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{3,32}$`)
	//go:embed web/*
	webFiles embed.FS
)

type Config struct {
	// Zero selects the default click budgets. Limits are per minute.
	ClicksPerMinute   int
	ClicksPerIPMinute int
	SecureCookies     bool
	TrustProxy        bool
	SessionTTL        time.Duration
	Logger            *slog.Logger
	Now               func() time.Time
	BackupDir         string
	// PasswordConcurrency bounds simultaneous HTTP password operations. Zero
	// selects up to half the available Go CPUs, with a maximum of four.
	PasswordConcurrency int
	passwordCost        int
}

type App struct {
	clicksPerMinute   int
	clicksPerIPMinute int
	playGuard         *playGuard
	store             *store.Store
	secureCookies     bool
	trustProxy        bool
	sessionTTL        time.Duration
	passwordCost      int
	logger            *slog.Logger
	now               func() time.Time
	limiter           *limiter
	dummyHash         []byte
	static            fs.FS
	backupDir         string
	requestGate       sync.RWMutex
	passwordSlots     chan struct{}
}

type contextKey int

const userContextKey contextKey = 1

func New(database *store.Store, config Config) (*App, error) {
	if database == nil {
		return nil, errors.New("store is required")
	}
	if config.ClicksPerMinute < 0 || config.ClicksPerMinute > 1_000_000 || config.ClicksPerIPMinute < 0 || config.ClicksPerIPMinute > 1_000_000 {
		return nil, errors.New("click budgets must be between 0 (default) and 1000000 per minute")
	}
	if config.ClicksPerMinute == 0 {
		config.ClicksPerMinute = 320
	}
	if config.ClicksPerIPMinute == 0 {
		config.ClicksPerIPMinute = defaultClicksPerIP
	}

	if config.PasswordConcurrency < 0 || config.PasswordConcurrency > 64 {
		return nil, errors.New("password concurrency must be between 0 (automatic) and 64")
	}
	if config.PasswordConcurrency == 0 {
		config.PasswordConcurrency = max(1, min(4, runtime.GOMAXPROCS(0)/2))
	}
	if config.SessionTTL <= 0 {
		config.SessionTTL = 180 * 24 * time.Hour
	}
	if config.SessionTTL < time.Second {
		return nil, errors.New("session lifetime must be at least one second")
	}
	if config.Logger == nil {
		config.Logger = slog.Default()
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	if config.BackupDir == "" {
		config.BackupDir = "data/backups"
	}
	if config.passwordCost == 0 {
		config.passwordCost = passwordHashCost
	}
	dummyHash := []byte(productionDummyHash)
	if config.passwordCost != passwordHashCost {
		var err error
		dummyHash, err = bcrypt.GenerateFromPassword([]byte("constant dummy password"), config.passwordCost)
		if err != nil {
			return nil, fmt.Errorf("prepare password verifier: %w", err)
		}
	}
	static, err := fs.Sub(webFiles, "web")
	if err != nil {
		return nil, fmt.Errorf("open embedded frontend: %w", err)
	}

	app := &App{
		clicksPerMinute:   config.ClicksPerMinute,
		clicksPerIPMinute: config.ClicksPerIPMinute,
		playGuard:         newPlayGuard(),
		store:             database,
		secureCookies:     config.SecureCookies,
		trustProxy:        config.TrustProxy,
		sessionTTL:        config.SessionTTL,
		passwordCost:      config.passwordCost,
		logger:            config.Logger,
		now:               config.Now,
		dummyHash:         dummyHash,
		static:            static,
		backupDir:         config.BackupDir,
		passwordSlots:     make(chan struct{}, config.PasswordConcurrency),
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
	mux.HandleFunc("GET /admin", a.requireAdmin(a.adminPage))
	mux.HandleFunc("GET /admin.html", a.requireAdmin(a.adminPage))
	mux.HandleFunc("GET /api/admin/overview", a.requireAdmin(a.adminOverview))
	mux.HandleFunc("GET /api/admin/storage", a.requireAdmin(a.adminStorage))
	mux.HandleFunc("GET /api/admin/players", a.requireAdmin(a.adminPlayers))
	mux.HandleFunc("GET /api/admin/players/{id}", a.requireAdmin(a.adminPlayer))
	mux.HandleFunc("GET /api/admin/players/{id}/entities", a.requireAdmin(a.adminEntities))
	mux.HandleFunc("GET /api/admin/activity", a.requireAdmin(a.adminActivity))
	mux.HandleFunc("GET /api/admin/audit", a.requireAdmin(a.adminAudit))
	mux.HandleFunc("POST /api/admin/backups/export", a.requireAdmin(a.adminExport))
	mux.HandleFunc("POST /api/admin/backups/restore", a.requireAdmin(a.adminRestore))

	// Compatibility aliases make the transition from the Rails API less abrupt.
	mux.HandleFunc("POST /auth/signup", a.signup)
	mux.HandleFunc("POST /auth/login", a.login)
	mux.HandleFunc("DELETE /auth/logout", a.logout)
	mux.HandleFunc("GET /me", a.requireUser(a.me))
	mux.HandleFunc("GET /entities/current", a.requireUser(a.current))
	mux.HandleFunc("POST /entities/increment", a.requireUser(a.increment))

	mux.HandleFunc("GET /", a.frontend)
	handler := a.securityHeaders(a.recoverPanic(a.rejectCrossSite(a.bodyLimit(a.globalLimit(mux)))))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Recovery authenticates and stages the upload before requesting exclusive
		// access. An anonymous or slow upload must not queue a global writer.
		if !(r.Method == http.MethodPost && r.URL.Path == "/api/admin/backups/restore") {
			a.requestGate.RLock()
			defer a.requestGate.RUnlock()
		}
		handler.ServeHTTP(w, r)
	})
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

	if !a.acquirePasswordSlot(w, r) {
		return
	}
	defer a.releasePasswordSlot()
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
		if errors.Is(err, store.ErrCredentialsChanged) {
			invalidCredentials(w)
			return
		}
		a.internalError(w, r, "start signup session", err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"user": publicUser(user)})
}

type loginPayload struct {
	Username       string `json:"username"`
	Email          string `json:"email"`
	Password       string `json:"password"`
	IdentifierType string `json:"identifier_type"`
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
	if payload.IdentifierType != "" && payload.IdentifierType != "auto" && payload.IdentifierType != "username" && payload.IdentifierType != "email" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Choose username or email as the sign-in method"})
		return
	}
	if len(identifier) > 254 || len(payload.Password) > 1024 {
		invalidCredentials(w)
		return
	}
	if ok, retry := a.limiter.allow("login-id:"+strings.ToLower(identifier), 3, time.Minute); !ok {
		rateLimited(w, retry)
		return
	}

	if !a.acquirePasswordSlot(w, r) {
		return
	}
	defer a.releasePasswordSlot()
	var user store.User
	var err error
	switch payload.IdentifierType {
	case "username":
		user, err = a.store.UserByUsername(r.Context(), identifier)
	case "email":
		user, err = a.store.UserByEmail(r.Context(), identifier)
	default:
		user, err = a.store.UserByIdentifier(r.Context(), identifier)
	}
	hash := a.dummyHash
	if err == nil {
		hash = []byte(user.PasswordHash)
	} else if !errors.Is(err, store.ErrNotFound) && !errors.Is(err, store.ErrAmbiguousIdentifier) {
		a.internalError(w, r, "find login user", err)
		return
	}
	passwordOK := bcrypt.CompareHashAndPassword(hash, []byte(payload.Password)) == nil
	if err != nil || !passwordOK {
		invalidCredentials(w)
		return
	}
	if err := a.startSession(w, r, user); err != nil {
		if errors.Is(err, store.ErrCredentialsChanged) {
			invalidCredentials(w)
			return
		}
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
	// A browser tab may still display an account whose cookie was replaced in
	// another tab. Bind its write to the displayed identity before consuming
	// per-account budgets or changing counters. Older clients may omit this.
	if expected := r.Header.Get("X-GoClick-User-ID"); expected != "" {
		id, err := strconv.ParseInt(expected, 10, 64)
		if err != nil || id <= 0 || expected != strconv.FormatInt(id, 10) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid expected account ID"})
			return
		}
		if id != user.ID {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "Your account changed in another tab. Refresh before clicking.", "code": "account_changed"})
			return
		}
	}
	if ok, retry := a.limiter.allow("click:"+strconv.FormatInt(user.ID, 10), a.clicksPerMinute, time.Minute); !ok {
		rateLimited(w, retry)
		return
	}
	if retry, reason := a.playGuard.allow(user.ID, a.now()); retry > 0 {
		if reason != "" {
			a.logger.Info("play cooldown", "user_id", user.ID, "reason", reason, "retry_after", retry.String())
		}
		rateLimitedReason(w, retry, "activity_cooldown", "Brief pause after sustained activity; try again shortly")
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
	ID        int64   `json:"id,string"`
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
	previous, _, valid := rawSessionToken(r)
	if !valid {
		previous = nil
	}
	if err := a.store.ReplaceSession(r.Context(), raw, previous, user, expires, now); err != nil {
		return err
	}
	a.setSessionCookie(w, raw, expires, now)
	return nil
}

func (a *App) setSessionCookie(w http.ResponseWriter, raw []byte, expires, now time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: base64.RawURLEncoding.EncodeToString(raw),
		Path: "/", Expires: expires, MaxAge: max(1, int(expires.Sub(now).Seconds())),
		HttpOnly: true, Secure: a.secureCookies, SameSite: http.SameSiteStrictMode,
	})
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
		now := a.now()
		session, err := a.store.UseSession(r.Context(), raw, now, a.sessionTTL)
		if errors.Is(err, store.ErrNotFound) {
			a.clearSessionCookie(w)
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid or expired session"})
			return
		}
		if err != nil {
			a.internalError(w, r, "authenticate session", err)
			return
		}
		if session.Renewed {
			a.setSessionCookie(w, raw, session.ExpiresAt, now)
		}
		next(w, r.WithContext(context.WithValue(r.Context(), userContextKey, session.User)))
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
			if ok, retry := a.limiter.allow("click-ip:"+a.clientIP(r), a.clicksPerIPMinute, time.Minute); !ok {
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
			if r.Method == http.MethodPost && r.URL.Path == "/api/admin/backups/restore" {
				if r.ContentLength > maxRestoreBody {
					writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "Backup upload exceeds 128 MiB"})
					return
				}
				r.Body = http.MaxBytesReader(w, r.Body, maxRestoreBody)
				next.ServeHTTP(w, r)
				return
			}
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
	protection := http.NewCrossOriginProtection()
	protection.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Cross-site request rejected"})
	}))
	return protection.Handler(next)
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
	// Serve only public assets here. Escaped slashes and dots can reach this
	// fallback instead of the protected /admin.html route, and future embedded
	// files must not become public merely by being added to the web directory.
	switch requested {
	case "index.html", "app.js", "app.css",
		"admin.js", "admin.css", "favicon.svg", "icons.svg", "button-material.svg", "button-glow.svg":
	default:
		http.NotFound(w, r)
		return
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
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Content-Type must be application/json"})
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "Request body is too large"})
		} else {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Request body must be valid JSON"})
		}
		return false
	}
	body = bytes.TrimSpace(body)
	if len(body) == 0 || body[0] != '{' {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Request body must contain one JSON object"})
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Request body must be valid JSON"})
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
	rateLimitedReason(w, retry, "rate_limited", "Too many requests; try again shortly")
}

func rateLimitedReason(w http.ResponseWriter, retry time.Duration, code, message string) {
	seconds := retry / time.Second
	if retry%time.Second != 0 {
		seconds++
	}
	if seconds < 1 {
		seconds = 1
	}
	w.Header().Set("Retry-After", strconv.FormatInt(int64(seconds), 10))
	writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": message, "code": code})
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
