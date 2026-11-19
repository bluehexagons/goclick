package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

const fortnight = 14
const fortnightMask = (1 << fortnight) - 1

var progressSchemaTable = schemaTable{
	"click_progress", []string{"user_id", "recent_days", "week_streak", "best_day_streak", "best_week_streak"},
}

// ClickProgress summarizes saved clicks as of the last click's UTC date.
// Bit zero of RecentDays is that date, bit one is the preceding date, and so on.
type ClickProgress struct {
	RecentDays     int   `json:"recent_days"`
	WeekStreak     int64 `json:"week_streak"`
	BestDayStreak  int64 `json:"best_day_streak"`
	BestWeekStreak int64 `json:"best_week_streak"`
}

func utcDay(t time.Time) int64 {
	return t.UTC().Truncate(24*time.Hour).Unix() / 86400
}

func utcWeek(day int64) int64 {
	// 1970-01-01 was Thursday. Floor division also handles pre-epoch dates.
	week, remainder := (day+3)/7, (day+3)%7
	if remainder < 0 {
		week--
	}
	return week
}

// Record a new run of consecutive active dates, strictly after previous.
func (p *ClickProgress) recordDays(previous, first, last int64) {
	length := last - first + 1
	p.RecentDays = ((p.RecentDays << min(fortnight, last-previous)) |
		((1 << min(fortnight, length)) - 1)) & fortnightMask
	before, start, end := utcWeek(previous), utcWeek(first), utcWeek(last)
	switch {
	case before == start:
		p.WeekStreak += end - start
	case before+1 == start:
		p.WeekStreak += end - start + 1
	default:
		p.WeekStreak = end - start + 1
	}
	p.BestWeekStreak = max(p.BestWeekStreak, p.WeekStreak)
}

func readCounters(ctx context.Context, tx *sql.Tx, userID int64) (Counters, bool, bool, error) {
	var counters Counters
	var last sql.NullString
	var recent, hours sql.NullInt64
	err := tx.QueryRowContext(ctx, `
		SELECT click_count, day_streak, month_streak, year_streak, last_clicked_at,
		       recent_days, coalesce(week_streak,0), coalesce(best_day_streak,0), coalesce(best_week_streak,0),
		       coalesce(day_clicks,0), coalesce(week_clicks,0), coalesce(month_clicks,0),
		       hours, coalesce(active_days,0), coalesce(active_months,0), coalesce(earned,0)
		FROM counters LEFT JOIN click_progress USING (user_id)
			LEFT JOIN click_achievements USING (user_id) WHERE counters.user_id = ?`, userID).
		Scan(&counters.Clicks, &counters.DayStreak, &counters.MonthStreak, &counters.YearStreak, &last,
			&recent, &counters.Progress.WeekStreak, &counters.Progress.BestDayStreak, &counters.Progress.BestWeekStreak,
			&counters.Achievements.DayClicks, &counters.Achievements.WeekClicks, &counters.Achievements.MonthClicks,
			&hours, &counters.Achievements.ActiveDays, &counters.Achievements.ActiveMonths, &counters.Achievements.Earned)
	if errors.Is(err, sql.ErrNoRows) {
		return Counters{}, false, false, nil
	}
	if err != nil {
		return Counters{}, false, false, fmt.Errorf("read counters: %w", err)
	}
	counters.Exists = true
	counters.Progress.RecentDays = int(recent.Int64)
	if last.Valid {
		parsed, err := parseTime(last.String)
		if err != nil {
			return Counters{}, false, false, fmt.Errorf("parse last click: %w", err)
		}
		counters.LastClickedAt = &parsed
	}
	if !recent.Valid {
		if err := counters.loadHistoricalProgress(ctx, tx, userID); err != nil {
			return Counters{}, false, false, err
		}
	}
	if hours.Valid {
		counters.Achievements.Hours = int(hours.Int64)
	} else if err := counters.loadHistoricalAchievements(ctx, tx, userID); err != nil {
		return Counters{}, false, false, err
	}
	return counters, recent.Valid, hours.Valid, nil
}

func (c *Counters) loadHistoricalProgress(ctx context.Context, tx *sql.Tx, userID int64) error {
	p := &c.Progress
	p.BestDayStreak = c.DayStreak
	if c.LastClickedAt == nil {
		return nil
	}
	last := utcDay(*c.LastClickedAt)
	// Imported counters can prove a trailing run even if there are no events
	// for it. Bound the inferred dates to the supported timestamp range.
	first := last - min(max(1, c.DayStreak)-1, last-utcDay(time.Date(-1, 1, 1, 0, 0, 0, 0, time.UTC)))
	rows, err := tx.QueryContext(ctx, `
		SELECT DISTINCT goclick_utc_day(occurred_at) AS day FROM player_activity
		WHERE user_id=? AND action='click' AND day<? ORDER BY day`, userID, first)
	if err != nil {
		return fmt.Errorf("read historical click dates: %w", err)
	}
	defer rows.Close()

	var daily int64
	// This sentinel predates every supported timestamp, with room for day math.
	previous := int64(-1 << 40)
	for rows.Next() {
		var day int64
		if err := rows.Scan(&day); err != nil {
			return fmt.Errorf("read historical click date: %w", err)
		}
		if day == previous+1 {
			daily++
		} else {
			daily = 1
		}
		p.BestDayStreak = max(p.BestDayStreak, daily)
		p.recordDays(previous, day, day)
		previous = day
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read historical click dates: %w", err)
	}
	if first != previous+1 {
		daily = 0
	}
	p.BestDayStreak = max(p.BestDayStreak, daily+last-first+1)
	p.recordDays(previous, first, last)
	return nil
}

func (p ClickProgress) save(ctx context.Context, tx *sql.Tx, userID int64) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO click_progress (user_id,recent_days,week_streak,best_day_streak,best_week_streak)
		VALUES (?,?,?,?,?)
		ON CONFLICT(user_id) DO UPDATE SET recent_days=excluded.recent_days,
			week_streak=excluded.week_streak, best_day_streak=excluded.best_day_streak,
			best_week_streak=excluded.best_week_streak`,
		userID, p.RecentDays, p.WeekStreak, p.BestDayStreak, p.BestWeekStreak)
	if err != nil {
		return fmt.Errorf("save click progress: %w", err)
	}
	return nil
}
