package webapp

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/bluehexagons/goclick/internal/store"
	"golang.org/x/crypto/bcrypt"
)

const maxBackupBytes = 128 << 20
const maxRestoreBody = maxBackupBytes + (64 << 10)

func (a *App) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return a.requireUser(func(w http.ResponseWriter, r *http.Request) {
		if !userFromContext(r.Context()).Admin {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Administrator access required"})
			return
		}
		next(w, r)
	})
}

func (a *App) adminPage(w http.ResponseWriter, r *http.Request) {
	content, err := a.static.Open("admin.html")
	if err != nil {
		a.internalError(w, r, "open admin panel", err)
		return
	}
	defer content.Close()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = io.Copy(w, content)
}

func pagination(w http.ResponseWriter, r *http.Request) (int, int, bool) {
	page, limit := 1, 25
	var err error
	if value := r.URL.Query().Get("page"); value != "" {
		page, err = strconv.Atoi(value)
		if err != nil {
			page = 0
		}
	}
	if value := r.URL.Query().Get("limit"); value != "" {
		limit, err = strconv.Atoi(value)
		if err != nil {
			limit = 0
		}
	}
	if page < 1 || page > 1_000_000 || limit < 1 || limit > 100 {
		writeJSON(w, 400, map[string]string{"error": "Invalid page or limit"})
		return 0, 0, false
	}
	return limit, (page - 1) * limit, true
}

func playerID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		writeJSON(w, 400, map[string]string{"error": "Invalid player ID"})
		return 0, false
	}
	return id, true
}

func (a *App) adminOverview(w http.ResponseWriter, r *http.Request) {
	out, err := a.store.AdminOverview(r.Context(), a.now())
	if err != nil {
		a.internalError(w, r, "read admin overview", err)
		return
	}
	writeJSON(w, 200, out)
}
func (a *App) adminPlayers(w http.ResponseWriter, r *http.Request) {
	limit, offset, ok := pagination(w, r)
	if !ok {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	sort := r.URL.Query().Get("sort")
	if sort == "" {
		sort = "recent"
	}
	if len(q) > 128 || (sort != "recent" && sort != "clicks" && sort != "username") {
		writeJSON(w, 400, map[string]string{"error": "Invalid player search or sort"})
		return
	}
	items, total, err := a.store.ListPlayers(r.Context(), q, sort, limit, offset)
	if err != nil {
		a.internalError(w, r, "list admin players", err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": total})
}
func (a *App) adminPlayer(w http.ResponseWriter, r *http.Request) {
	id, ok := playerID(w, r)
	if !ok {
		return
	}
	player, err := a.store.AdminPlayer(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, 404, map[string]string{"error": "Player not found"})
		return
	}
	if err != nil {
		a.internalError(w, r, "read admin player", err)
		return
	}
	writeJSON(w, 200, player)
}
func (a *App) adminEntities(w http.ResponseWriter, r *http.Request) {
	id, ok := playerID(w, r)
	if !ok {
		return
	}
	limit, offset, ok := pagination(w, r)
	if !ok {
		return
	}
	if _, err := a.store.AdminPlayer(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, 404, map[string]string{"error": "Player not found"})
		} else {
			a.internalError(w, r, "read archive player", err)
		}
		return
	}
	items, total, err := a.store.ArchivedEntities(r.Context(), id, limit, offset)
	if err != nil {
		a.internalError(w, r, "read admin archive", err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": total})
}
func (a *App) adminActivity(w http.ResponseWriter, r *http.Request) {
	limit, offset, ok := pagination(w, r)
	if !ok {
		return
	}
	var id int64
	if value := r.URL.Query().Get("user_id"); value != "" {
		var err error
		id, err = strconv.ParseInt(value, 10, 64)
		if err != nil || id < 1 {
			writeJSON(w, 400, map[string]string{"error": "Invalid player ID"})
			return
		}
	}
	items, total, err := a.store.Activity(r.Context(), id, limit, offset)
	if err != nil {
		a.internalError(w, r, "read admin activity", err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": total})
}
func (a *App) adminAudit(w http.ResponseWriter, r *http.Request) {
	limit, offset, ok := pagination(w, r)
	if !ok {
		return
	}
	items, total, err := a.store.Audit(r.Context(), limit, offset)
	if err != nil {
		a.internalError(w, r, "read admin audit", err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": total})
}

func (a *App) allowAdminPassword(w http.ResponseWriter, r *http.Request) bool {
	if ok, retry := a.limiter.allow("admin-password:"+strconv.FormatInt(userFromContext(r.Context()).ID, 10), 3, time.Minute); !ok {
		rateLimited(w, retry)
		return false
	}
	return true
}
func (a *App) checkAdminPassword(w http.ResponseWriter, r *http.Request, password, action string) bool {
	user := userFromContext(r.Context())
	if len(password) == 0 || len(password) > 1024 || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		if err := a.store.RecordAdminAudit(r.Context(), user, action, "denied", "Password verification failed", a.now()); err != nil {
			a.logger.Error("record admin denial", "error", err)
		}
		writeJSON(w, 403, map[string]string{"error": "Current password is incorrect"})
		return false
	}
	return true
}

func adminDeadline(w http.ResponseWriter, r *http.Request) (*http.Request, context.CancelFunc) {
	controller := http.NewResponseController(w)
	_ = controller.SetReadDeadline(time.Now().Add(2 * time.Minute))
	_ = controller.SetWriteDeadline(time.Now().Add(2 * time.Minute))
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	return r.WithContext(ctx), cancel
}

func (a *App) adminExport(w http.ResponseWriter, r *http.Request) {
	if !a.allowAdminPassword(w, r) {
		return
	}
	var payload struct {
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &payload) || !a.checkAdminPassword(w, r, payload.Password, "backup_export") {
		return
	}
	r, cancel := adminDeadline(w, r)
	defer cancel()
	directory, err := os.MkdirTemp("", "goclick-export-")
	if err != nil {
		a.internalError(w, r, "stage backup export", err)
		return
	}
	defer os.RemoveAll(directory)
	name, err := a.store.Backup(r.Context(), directory, "goclick")
	if err != nil {
		a.internalError(w, r, "export backup", err)
		return
	}
	file, err := os.Open(name)
	if err != nil {
		a.internalError(w, r, "open backup export", err)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		a.internalError(w, r, "inspect backup export", err)
		return
	}
	if err := a.store.RecordAdminAudit(r.Context(), userFromContext(r.Context()), "backup_export", "success", "SQLite snapshot created", a.now()); err != nil {
		a.internalError(w, r, "audit backup export", err)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Disposition", `attachment; filename="goclick-`+a.now().UTC().Format("20060102T150405Z")+`.db"`)
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	w.WriteHeader(200)
	_, _ = io.Copy(w, file)
}

func (a *App) adminRestore(w http.ResponseWriter, r *http.Request) {
	a.adminDatabaseUpload(w, r, false)
}

func (a *App) adminImport(w http.ResponseWriter, r *http.Request) {
	a.adminDatabaseUpload(w, r, true)
}

func (a *App) adminDatabaseUpload(w http.ResponseWriter, r *http.Request, importing bool) {
	confirmationWord, action := "RESTORE", "backup_restore"
	if importing {
		confirmationWord, action = "IMPORT", "rails_import"
	}
	if !a.allowAdminPassword(w, r) {
		return
	}
	r, cancel := adminDeadline(w, r)
	defer cancel()
	reader, err := r.MultipartReader()
	if err != nil {
		writeJSON(w, 415, map[string]string{"error": "Database recovery requires a multipart file upload"})
		return
	}
	directory, err := os.MkdirTemp("", "goclick-upload-")
	if err != nil {
		a.internalError(w, r, "stage database upload", err)
		return
	}
	defer os.RemoveAll(directory)
	file, err := os.CreateTemp(directory, "upload-*.db")
	if err != nil {
		a.internalError(w, r, "create database upload", err)
		return
	}
	defer file.Close()
	seen := make(map[string]bool)
	password, confirmation := "", ""
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			a.uploadError(w, err)
			return
		}
		name := part.FormName()
		if seen[name] || (name != "backup" && name != "password" && name != "confirmation") {
			part.Close()
			writeJSON(w, 400, map[string]string{"error": "Unexpected or repeated upload field"})
			return
		}
		seen[name] = true
		if name == "backup" {
			n, err := io.Copy(file, io.LimitReader(part, maxBackupBytes+1))
			if err != nil {
				part.Close()
				a.uploadError(w, err)
				return
			}
			if n == 0 || n > maxBackupBytes {
				part.Close()
				writeJSON(w, 413, map[string]string{"error": "Backup must be between 1 byte and 128 MiB"})
				return
			}
		} else {
			value, err := io.ReadAll(io.LimitReader(part, 1025))
			if err != nil {
				part.Close()
				a.uploadError(w, err)
				return
			}
			if len(value) > 1024 {
				part.Close()
				writeJSON(w, 400, map[string]string{"error": "Upload field is too long"})
				return
			}
			if name == "password" {
				password = string(value)
			} else {
				confirmation = string(value)
			}
		}
		part.Close()
	}
	// Drain epilogue too, preserving the bound for chunked multipart requests.
	if _, err := io.Copy(io.Discard, r.Body); err != nil {
		a.uploadError(w, err)
		return
	}
	if !seen["backup"] || confirmation != confirmationWord {
		writeJSON(w, 400, map[string]string{"error": "Choose a database and type " + confirmationWord + " to confirm"})
		return
	}
	if !a.checkAdminPassword(w, r, password, action) {
		return
	}
	if err := file.Close(); err != nil {
		a.internalError(w, r, "close database upload", err)
		return
	}
	actor := userFromContext(r.Context())
	if importing {
		a.importUpload(w, r, file.Name(), actor)
		return
	}
	result, err := a.store.Restore(r.Context(), file.Name(), a.backupDir, actor, a.now())
	if err != nil {
		if auditErr := a.store.RecordAdminAudit(r.Context(), actor, "backup_restore", "failed", "Restore did not commit", a.now()); auditErr != nil {
			a.logger.Error("audit failed restore", "error", auditErr)
		}
		if errors.Is(err, store.ErrInvalidBackup) {
			writeJSON(w, 422, map[string]string{"error": err.Error()})
			return
		}
		a.internalError(w, r, "restore backup", err)
		return
	}
	a.logger.Info("backup restored", "actor_id", actor.ID, "recovery_backup", result.RecoveryBackup, "users", result.Users, "entities", result.Entities)
	a.clearSessionCookie(w)
	writeJSON(w, 200, result)
}

func (a *App) importUpload(w http.ResponseWriter, r *http.Request, path string, actor store.User) {
	file, err := os.Open(path)
	if err != nil {
		a.internalError(w, r, "inspect legacy upload", err)
		return
	}
	header := make([]byte, 16)
	_, _ = io.ReadFull(file, header)
	file.Close()
	format := "json"
	if string(header) == "SQLite format 3\x00" {
		format = "sqlite"
	}
	if format == "json" {
		info, err := os.Stat(path)
		if err != nil {
			a.internalError(w, r, "inspect JSON upload", err)
			return
		}
		if info.Size() > store.MaxRailsJSONBytes {
			writeJSON(w, 413, map[string]string{"error": "Rails JSON export exceeds 16 MiB"})
			return
		}
	}
	recovery, err := a.store.Backup(r.Context(), a.backupDir, "pre-import-"+a.now().UTC().Format("20060102T150405Z"))
	if err != nil {
		a.internalError(w, r, "save pre-import snapshot", err)
		return
	}
	var result store.ImportResult
	audit := store.ImportAudit{Actor: actor, Now: a.now()}
	if format == "sqlite" {
		result, err = a.store.ImportRails(r.Context(), path, audit)
	} else {
		result, err = a.store.ImportRailsJSON(r.Context(), path, audit)
	}
	if err != nil {
		if auditErr := a.store.RecordAdminAudit(r.Context(), actor, "rails_import", "failed", "Import did not commit", a.now()); auditErr != nil {
			a.logger.Error("audit failed import", "error", auditErr)
		}
		writeJSON(w, 422, map[string]string{"error": err.Error()})
		return
	}
	a.logger.Info("Rails import completed", "actor_id", actor.ID, "format", format, "users", result.Users)
	writeJSON(w, 200, map[string]any{"users": result.Users, "entities": result.Entities, "counters": result.Counters, "format": format, "recovery_backup": filepath.Base(recovery), "new_passwords_required": format == "json"})
}

func (a *App) uploadError(w http.ResponseWriter, err error) {
	if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
		writeJSON(w, 413, map[string]string{"error": "Backup upload exceeds 128 MiB"})
	} else {
		writeJSON(w, 400, map[string]string{"error": "Incomplete or invalid backup upload"})
	}
}
