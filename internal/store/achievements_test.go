package store

import (
	"context"
	"database/sql"
	"slices"
	"testing"
	"time"
)

func TestAccountBadgeIDsUseDurableProgress(t *testing.T) {
	counters := Counters{
		Clicks:       500,
		Progress:     ClickProgress{BestDayStreak: 7, BestWeekStreak: 4},
		Achievements: ClickAchievements{Earned: century},
	}
	if got := counters.EarnedBadgeIDs(); len(got) != 9 || !slices.Contains(got, "busy-day") {
		t.Fatalf("nine earned badges, including a past period badge, expected: %v", got)
	}
	counters.Achievements.ActiveDays = 10
	want := []string{
		"gone-click", "sentence", "paragraph", "essay", "clicks-for-days", "one-week-streak",
		"good-to-see-you-again", "double-fortnight", "busy-day", "returning-clicker", "recursion",
	}
	if got := counters.EarnedBadgeIDs(); !slices.Equal(got, want) {
		t.Fatalf("earned badges = %v, want %v", got, want)
	}
}

func TestCalendarAchievementPeriods(t *testing.T) {
	var a ClickAchievements
	sunday := time.Date(2026, 1, 25, 21, 0, 0, 0, time.UTC)
	a.record(nil, sunday, 99)
	if a.Earned != 0 {
		t.Fatalf("99 clicks earned a badge: %+v", a)
	}
	a.record(&sunday, sunday, 1)
	late := sunday.Add(time.Hour)
	a.record(&sunday, late, 1000)
	lastHour := late.Add(time.Hour)
	a.record(&late, lastHour, 3898)
	if a.Earned != century|fourDigits|threeVisits {
		t.Fatalf("Sunday milestones: %+v", a)
	}
	monday := lastHour.Add(time.Hour)
	a.record(&lastHour, monday, 1)
	if a.DayClicks != 1 || a.WeekClicks != 1 || a.MonthClicks != 4999 || a.Hours != 1 {
		t.Fatalf("midnight Monday should reset only day and week: %+v", a)
	}
	a.record(&monday, monday, 1)
	february := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	a.record(&monday, february, 1)
	if a.MonthClicks != 1 || a.WeekClicks != 3 || a.Earned != 15 || a.ActiveDays != 3 || a.ActiveMonths != 2 {
		t.Fatalf("first of February should reset the month and keep all badges: %+v", a)
	}
}

func TestSchemaSixAchievementBackfillAndRestore(t *testing.T) {
	db, user := adminFixture(t)
	ctx := context.Background()
	now := time.Date(2026, 1, 5, 5, 2, 0, 0, time.UTC)
	for _, at := range []time.Time{now.Add(-4 * time.Hour), now.Add(-3 * time.Hour), now} {
		if _, err := db.Increment(ctx, user.ID, at); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := db.Backup(ctx, t.TempDir(), "v6")
	if err != nil {
		t.Fatal(err)
	}
	old, err := sql.Open("sqlite", snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := old.Exec(`DROP TABLE click_achievements; PRAGMA user_version=6`); err != nil {
		old.Close()
		t.Fatal(err)
	}
	if _, err := old.Exec(`
		WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<97)
		INSERT INTO player_activity(user_id,action,occurred_at)
		SELECT ?1,'click','2026-01-05T06:00:00+01:00' FROM n`, user.ID); err != nil {
		old.Close()
		t.Fatal(err)
	}
	if err := old.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Increment(ctx, user.ID, now.AddDate(0, 0, 1)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Restore(ctx, snapshot, t.TempDir(), user, now.AddDate(0, 0, 2)); err != nil {
		t.Fatal(err)
	}
	read, err := db.CurrentCounters(ctx, user.ID)
	if err != nil || read.Achievements.Earned != century|threeVisits || read.Achievements.DayClicks != 100 ||
		read.Achievements.Hours != (1<<1)|(1<<2)|(1<<5) || read.Achievements.ActiveDays != 1 {
		t.Fatalf("restored historical achievements: %+v, %v", read.Achievements, err)
	}
	clicked, err := db.Increment(ctx, user.ID, now.AddDate(0, 0, 1))
	if err != nil || clicked.Achievements.Earned != read.Achievements.Earned || clicked.Achievements.ActiveDays != 2 {
		t.Fatalf("click after backfill: %+v, %v", clicked.Achievements, err)
	}
}
