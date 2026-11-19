package store

import (
	"context"
	"database/sql"
	"fmt"
	"math/bits"
	"time"
)

var achievementSchemaTable = schemaTable{
	"click_achievements", []string{"user_id", "day_clicks", "week_clicks", "month_clicks", "hours", "active_days", "active_months", "earned"},
}

// ClickAchievements caps progress at each badge's target and keeps earned
// calendar badges after their qualifying period has passed.
type ClickAchievements struct {
	DayClicks    int64 `json:"day_clicks"`
	WeekClicks   int64 `json:"week_clicks"`
	MonthClicks  int64 `json:"month_clicks"`
	Hours        int   `json:"hours"`
	ActiveDays   int64 `json:"active_days"`
	ActiveMonths int64 `json:"active_months"`
	Earned       int   `json:"earned"`
}

const (
	century = 1 << iota
	fourDigits
	fiveGrand
	threeVisits
)

func (a *ClickAchievements) unlock() {
	if a.DayClicks >= 100 {
		a.Earned |= century
	}
	if a.WeekClicks >= 1000 {
		a.Earned |= fourDigits
	}
	if a.MonthClicks >= 5000 {
		a.Earned |= fiveGrand
	}
	if bits.OnesCount(uint(a.Hours)) >= 3 {
		a.Earned |= threeVisits
	}
}

// record takes a batch of one or more clicks from the same UTC hour. The
// previous recorded instant, when present, is at or before the new one.
func (a *ClickAchievements) record(previous *time.Time, now time.Time, count int64) {
	day := utcDay(now)
	if previous == nil || utcDay(*previous) != day {
		a.DayClicks, a.Hours = 0, 0
		a.ActiveDays = min(10, a.ActiveDays+1)
	}
	if previous == nil || utcWeek(utcDay(*previous)) != utcWeek(day) {
		a.WeekClicks = 0
	}
	if previous == nil || monthKey(*previous) != monthKey(now) {
		a.MonthClicks = 0
		a.ActiveMonths = min(3, a.ActiveMonths+1)
	}
	a.DayClicks = min(100, a.DayClicks+min(100, count))
	a.WeekClicks = min(1000, a.WeekClicks+min(1000, count))
	a.MonthClicks = min(5000, a.MonthClicks+min(5000, count))
	a.Hours |= 1 << now.Hour()
	a.unlock()
}

func (c *Counters) loadHistoricalAchievements(ctx context.Context, tx *sql.Tx, userID int64) error {
	a := &c.Achievements
	a.ActiveDays = min(10, c.DayStreak)
	a.ActiveMonths = min(3, c.MonthStreak)
	if c.LastClickedAt == nil {
		return nil
	}
	last := *c.LastClickedAt
	rows, err := tx.QueryContext(ctx, `
		SELECT goclick_utc_hour(occurred_at) AS hour, count(*) FROM player_activity
		WHERE user_id=? AND action='click' AND goclick_time_key(occurred_at)<=?
		GROUP BY hour ORDER BY hour`, userID, timestampSortKey(last))
	if err != nil {
		return fmt.Errorf("read historical achievement activity: %w", err)
	}
	defer rows.Close()

	var previous *time.Time
	var recorded ClickAchievements
	// Count recorded dates outside the known trailing streaks so the same
	// period can contribute evidence from either source without duplication.
	dayFloor := utcDay(last) - a.ActiveDays + 1
	monthFloor := time.Date(last.Year(), last.Month()+1-time.Month(a.ActiveMonths), 1, 0, 0, 0, 0, time.UTC)
	var earlierDays, earlierMonths int64
	for rows.Next() {
		var hour, count int64
		if err := rows.Scan(&hour, &count); err != nil {
			return fmt.Errorf("read achievement activity hour: %w", err)
		}
		when := time.Unix(hour*3600, 0).UTC()
		if utcDay(when) < dayFloor && (previous == nil || utcDay(*previous) != utcDay(when)) {
			earlierDays++
		}
		if when.Before(monthFloor) && (previous == nil || monthKey(*previous) != monthKey(when)) {
			earlierMonths++
		}
		recorded.record(previous, when, count)
		previous = &when
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read historical achievement activity: %w", err)
	}
	// The counter also proves a click in its last hour, even if the event
	// predates activity logging. Avoid counting the same click twice.
	if previous == nil || !previous.Equal(last.Truncate(time.Hour)) {
		recorded.record(previous, last, 1)
	}
	recorded.ActiveDays = max(recorded.ActiveDays, min(10, earlierDays+a.ActiveDays))
	recorded.ActiveMonths = max(recorded.ActiveMonths, min(3, earlierMonths+a.ActiveMonths))
	*a = recorded
	return nil
}

func (a ClickAchievements) save(ctx context.Context, tx *sql.Tx, userID int64) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO click_achievements (user_id,day_clicks,week_clicks,month_clicks,hours,active_days,active_months,earned)
		VALUES (?,?,?,?,?,?,?,?)
		ON CONFLICT(user_id) DO UPDATE SET day_clicks=excluded.day_clicks,week_clicks=excluded.week_clicks,
			month_clicks=excluded.month_clicks,hours=excluded.hours,active_days=excluded.active_days,
			active_months=excluded.active_months,earned=excluded.earned`,
		userID, a.DayClicks, a.WeekClicks, a.MonthClicks, a.Hours, a.ActiveDays, a.ActiveMonths, a.Earned)
	if err != nil {
		return fmt.Errorf("save click achievements: %w", err)
	}
	return nil
}
