package webapp

import "net/http"

// Do not queue CPU-heavy password operations behind other password work. The
// IP and identifier quotas still apply, but this budget is shared by signup,
// login (including unknown users), and administrator password verification.
func (a *App) acquirePasswordSlot(w http.ResponseWriter, r *http.Request) bool {
	if r.Context().Err() == nil {
		select {
		case a.passwordSlots <- struct{}{}:
			return true
		default:
		}
	}
	w.Header().Set("Retry-After", "1")
	writeJSON(w, http.StatusServiceUnavailable, map[string]string{
		"error": "Authentication is busy. Try again shortly.",
		"code":  "authentication_busy",
	})
	return false
}

func (a *App) releasePasswordSlot() { <-a.passwordSlots }
