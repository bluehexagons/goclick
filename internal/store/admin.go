package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrLastAdmin = errors.New("cannot revoke the last administrator")

func (s *Store) UserByUsername(ctx context.Context, username string) (User, error) {
	return scanUser(s.db.QueryRowContext(ctx, `SELECT id,username,email,password_hash,admin,created_at,updated_at FROM users WHERE username=?`, username))
}

func allSchemaTables() []schemaTable {
	tables := append([]schemaTable{}, coreSchemaTables...)
	return append(tables, archiveSchemaTable,
		schemaTable{"player_activity", []string{"id", "user_id", "action", "occurred_at", "click_count"}},
		schemaTable{"admin_audit", []string{"id", "actor_id", "actor_username", "action", "target_user_id", "result", "details", "occurred_at"}})
}

// SetAdmin is an operator-only operation. Revoking sessions requires a fresh
// sign-in after either promotion or demotion, including for the first admin.
func (s *Store) SetAdmin(ctx context.Context, userID int64, admin bool, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Take the SQLite writer lock before checking the last-admin invariant.
	result, err := tx.ExecContext(ctx, `UPDATE users SET updated_at = updated_at WHERE id = ?`, userID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrNotFound
	}
	var current bool
	if err := tx.QueryRowContext(ctx, `SELECT admin FROM users WHERE id = ?`, userID).Scan(&current); err != nil {
		return err
	}
	if current == admin {
		return nil
	}
	if !admin {
		var admins int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE admin = 1`).Scan(&admins); err != nil {
			return err
		}
		if admins <= 1 {
			return ErrLastAdmin
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE users SET admin = ?, updated_at = ? WHERE id = ?`, admin, formatTime(now), userID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, userID); err != nil {
		return err
	}
	action := "admin_granted"
	if !admin {
		action = "admin_revoked"
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO admin_audit(actor_username,action,target_user_id,result,details,occurred_at) VALUES ('operator',?,?,'success','',?)`, action, userID, formatTime(now)); err != nil {
		return err
	}
	return tx.Commit()
}

type AdminPlayer struct {
	ID            int64   `json:"id"`
	Username      string  `json:"username"`
	Email         *string `json:"email"`
	Admin         bool    `json:"admin"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
	Clicks        int64   `json:"clicks"`
	DayStreak     int64   `json:"day_streak"`
	MonthStreak   int64   `json:"month_streak"`
	YearStreak    int64   `json:"year_streak"`
	LastClickedAt *string `json:"last_clicked_at"`
	LastSignInAt  *string `json:"last_sign_in_at"`
}

type Activity struct {
	ID         int64  `json:"id"`
	UserID     int64  `json:"user_id"`
	Username   string `json:"username"`
	Action     string `json:"action"`
	OccurredAt string `json:"occurred_at"`
	ClickCount *int64 `json:"click_count"`
}

type DailyClicks struct {
	Date   string `json:"date"`
	Clicks int64  `json:"clicks"`
}

type Overview struct {
	Players        int64         `json:"players"`
	Admins         int64         `json:"admins"`
	Clicks         int64         `json:"clicks"`
	ActivePlayers  int64         `json:"active_players_24h"`
	ActiveSessions int64         `json:"active_sessions"`
	Clicks24h      int64         `json:"clicks_24h"`
	Daily          []DailyClicks `json:"daily_clicks"`
}

func (s *Store) AdminOverview(ctx context.Context, now time.Time) (Overview, error) {
	now = now.UTC()
	var out Overview
	err := s.db.QueryRowContext(ctx, `SELECT
		(SELECT COUNT(*) FROM users), (SELECT COUNT(*) FROM users WHERE admin = 1),
		(SELECT COALESCE(SUM(click_count),0) FROM counters),
		(SELECT COUNT(*) FROM counters WHERE last_clicked_at >= ?),
		(SELECT COUNT(*) FROM sessions JOIN users ON users.id=sessions.user_id WHERE expires_at > ? AND (users.admin=0 OR sessions.created_at > ?)),
		(SELECT COUNT(*) FROM player_activity WHERE action='click' AND occurred_at >= ?)`, formatTime(now.Add(-24*time.Hour)), now.Unix(), now.Add(-AdminSessionTTL).Unix(), formatTime(now.Add(-24*time.Hour))).Scan(&out.Players, &out.Admins, &out.Clicks, &out.ActivePlayers, &out.ActiveSessions, &out.Clicks24h)
	if err != nil {
		return out, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT substr(occurred_at,1,10), COUNT(*) FROM player_activity WHERE action='click' AND occurred_at >= ? GROUP BY substr(occurred_at,1,10) ORDER BY 1`, dateKey(now.AddDate(0, 0, -6)))
	if err != nil {
		return out, err
	}
	defer rows.Close()
	counts := make(map[string]int64)
	for rows.Next() {
		var day string
		var n int64
		if err := rows.Scan(&day, &n); err != nil {
			return out, err
		}
		counts[day] = n
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	out.Daily = make([]DailyClicks, 0, 7)
	for i := 6; i >= 0; i-- {
		day := dateKey(now.UTC().AddDate(0, 0, -i))
		out.Daily = append(out.Daily, DailyClicks{day, counts[day]})
	}
	return out, nil
}

func (s *Store) ListPlayers(ctx context.Context, search, sort string, limit, offset int) ([]AdminPlayer, int64, error) {
	orders := map[string]string{"recent": "c.last_clicked_at DESC, u.id DESC", "clicks": "COALESCE(c.click_count,0) DESC, u.id DESC", "username": "u.username, u.id"}
	order, ok := orders[sort]
	if !ok || limit < 1 || limit > 100 || offset < 0 {
		return nil, 0, errors.New("invalid player query")
	}
	search = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(search)
	pattern := "%" + search + "%"
	var total int64
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE username LIKE ? ESCAPE '\' OR email LIKE ? ESCAPE '\'`, pattern, pattern).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT u.id,u.username,u.email,u.admin,u.created_at,u.updated_at,
		COALESCE(c.click_count,0),COALESCE(c.day_streak,0),COALESCE(c.month_streak,0),COALESCE(c.year_streak,0),c.last_clicked_at,
		(SELECT MAX(occurred_at) FROM player_activity WHERE user_id=u.id AND action='sign_in')
		FROM users u LEFT JOIN counters c ON c.user_id=u.id
		WHERE u.username LIKE ? ESCAPE '\' OR u.email LIKE ? ESCAPE '\'
		ORDER BY `+order+` LIMIT ? OFFSET ?`, pattern, pattern, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	players := make([]AdminPlayer, 0)
	for rows.Next() {
		p, err := scanAdminPlayer(rows)
		if err != nil {
			return nil, 0, err
		}
		players = append(players, p)
	}
	return players, total, rows.Err()
}

func scanAdminPlayer(row rowScanner) (AdminPlayer, error) {
	var p AdminPlayer
	err := row.Scan(&p.ID, &p.Username, &p.Email, &p.Admin, &p.CreatedAt, &p.UpdatedAt, &p.Clicks, &p.DayStreak, &p.MonthStreak, &p.YearStreak, &p.LastClickedAt, &p.LastSignInAt)
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

func (s *Store) AdminPlayer(ctx context.Context, id int64) (AdminPlayer, error) {
	return scanAdminPlayer(s.db.QueryRowContext(ctx, `SELECT u.id,u.username,u.email,u.admin,u.created_at,u.updated_at,
		COALESCE(c.click_count,0),COALESCE(c.day_streak,0),COALESCE(c.month_streak,0),COALESCE(c.year_streak,0),c.last_clicked_at,
		(SELECT MAX(occurred_at) FROM player_activity WHERE user_id=u.id AND action='sign_in')
		FROM users u LEFT JOIN counters c ON c.user_id=u.id WHERE u.id=?`, id))
}

func (s *Store) Activity(ctx context.Context, userID int64, limit, offset int) ([]Activity, int64, error) {
	if limit < 1 || limit > 100 || offset < 0 {
		return nil, 0, errors.New("invalid activity query")
	}
	var total int64
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM player_activity WHERE (?=0 OR user_id=?)`, userID, userID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT a.id,a.user_id,u.username,a.action,a.occurred_at,a.click_count FROM player_activity a JOIN users u ON u.id=a.user_id WHERE (?=0 OR a.user_id=?) ORDER BY a.id DESC LIMIT ? OFFSET ?`, userID, userID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := make([]Activity, 0)
	for rows.Next() {
		var item Activity
		if err := rows.Scan(&item.ID, &item.UserID, &item.Username, &item.Action, &item.OccurredAt, &item.ClickCount); err != nil {
			return nil, 0, err
		}
		items = append(items, item)
	}
	return items, total, rows.Err()
}

type ArchivedEntity struct {
	ID           int64   `json:"id"`
	UserID       int64   `json:"user_id"`
	Kind         *string `json:"kind"`
	Count        *int64  `json:"count"`
	CreatedTime  *string `json:"created_time"`
	ModifiedTime *string `json:"modified_time"`
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    string  `json:"updated_at"`
}

func (s *Store) ArchivedEntities(ctx context.Context, id int64, limit, offset int) ([]ArchivedEntity, int64, error) {
	if limit < 1 || limit > 100 || offset < 0 {
		return nil, 0, fmt.Errorf("invalid archive query")
	}
	var total int64
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM rails_entities WHERE user_id=?`, id).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,user_id,kind,count,created_time,modified_time,created_at,updated_at FROM rails_entities WHERE user_id=? ORDER BY id LIMIT ? OFFSET ?`, id, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := make([]ArchivedEntity, 0)
	for rows.Next() {
		e, err := scanRailsEntity(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, ArchivedEntity(e))
	}
	return items, total, rows.Err()
}

func (s *Store) RecordAdminAudit(ctx context.Context, actor User, action, result, details string, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO admin_audit(actor_id,actor_username,action,result,details,occurred_at) VALUES (?,?,?,?,?,?)`, actor.ID, actor.Username, action, result, details, formatTime(now))
	return err
}

type AuditEvent struct {
	ID            int64  `json:"id"`
	ActorUsername string `json:"actor_username"`
	Action        string `json:"action"`
	Result        string `json:"result"`
	OccurredAt    string `json:"occurred_at"`
}

func (s *Store) Audit(ctx context.Context, limit, offset int) ([]AuditEvent, int64, error) {
	var total int64
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM admin_audit`).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,actor_username,action,result,occurred_at FROM admin_audit ORDER BY id DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := make([]AuditEvent, 0)
	for rows.Next() {
		var e AuditEvent
		if err := rows.Scan(&e.ID, &e.ActorUsername, &e.Action, &e.Result, &e.OccurredAt); err != nil {
			return nil, 0, err
		}
		items = append(items, e)
	}
	return items, total, rows.Err()
}
