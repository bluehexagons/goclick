package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"slices"
	"testing"
	"time"
)

func TestAccountBadgeIDsMatchOfflineFixtures(t *testing.T) {
	raw, err := os.ReadFile("testdata/achievement-badges.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Counters
		Name   string
		Earned []string
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			if got := fixture.EarnedBadgeIDs(); !slices.Equal(got, fixture.Earned) {
				t.Fatalf("earned badges = %v, want %v", got, fixture.Earned)
			}
		})
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
	if _, err := old.Exec(`DROP TABLE button_achievements; DROP TABLE click_achievements; PRAGMA user_version=6`); err != nil {
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

func TestButtonAchievementsSurviveNativeBackupRestore(t *testing.T) {
	db, user := adminFixture(t)
	ctx := context.Background()
	now := time.Date(2026, 1, 5, 5, 2, 0, 0, time.UTC)
	for range 2 {
		got, err := db.RecordButtonAchievement(ctx, user.ID, ReconnectedPlug)
		if err != nil || got != ReconnectedPlug {
			t.Fatalf("record reconnect = %d, %v", got, err)
		}
	}
	before, err := db.CurrentCounters(ctx, user.ID)
	if err != nil || before.Exists || !slices.Equal(before.EarnedBadgeIDs(), []string{"live-wire"}) {
		t.Fatalf("badge before playing = %+v, %v", before, err)
	}
	clicked, err := db.IncrementWithButtonAchievements(ctx, user.ID, now, SlackCordClick|Rebound|HoldThatThought)
	if err != nil || clicked.Clicks != 1 || clicked.ButtonAchievements != ReconnectedPlug|SlackCordClick|Rebound|HoldThatThought {
		t.Fatalf("save click with gestures = %+v, %v", clicked, err)
	}
	snapshot, err := db.Backup(ctx, t.TempDir(), "hardware")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.RecordButtonAchievement(ctx, user.ID, ResetOutlet); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Restore(ctx, snapshot, t.TempDir(), user, now); err != nil {
		t.Fatal(err)
	}
	after, err := db.CurrentCounters(ctx, user.ID)
	if err != nil || after.Clicks != 1 ||
		!slices.Equal(after.EarnedBadgeIDs(), []string{"gone-click", "live-wire", "hanging-loose", "rebound", "hold-that-thought"}) {
		t.Fatalf("restored button achievements = %+v, %v", after, err)
	}

	old, err := sql.Open("sqlite", snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := old.Exec(`DROP TABLE button_achievements; PRAGMA user_version=7`); err != nil {
		old.Close()
		t.Fatal(err)
	}
	if err := old.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Restore(ctx, snapshot, t.TempDir(), user, now); err != nil {
		t.Fatal(err)
	}
	after, err = db.CurrentCounters(ctx, user.ID)
	if err != nil || after.Clicks != 1 || after.ButtonAchievements != 0 {
		t.Fatalf("schema 7 restore with no button achievements = %+v, %v", after, err)
	}
}

func TestVersionEightButtonAchievementsRestoreAndMigrate(t *testing.T) {
	db, user := adminFixture(t)
	ctx := context.Background()
	now := time.Date(2026, 1, 5, 5, 2, 0, 0, time.UTC)
	if _, err := db.RecordButtonAchievement(ctx, user.ID, ReconnectedPlug); err != nil {
		t.Fatal(err)
	}
	if _, err := db.IncrementWithButtonAchievements(ctx, user.ID, now, SlackCordClick); err != nil {
		t.Fatal(err)
	}
	snapshot, err := db.Backup(ctx, t.TempDir(), "version-eight")
	if err != nil {
		t.Fatal(err)
	}
	old, err := sql.Open("sqlite", snapshot)
	if err != nil {
		t.Fatal(err)
	}
	_, err = old.Exec(`
ALTER TABLE button_achievements RENAME TO saved_button_achievements;
CREATE TABLE button_achievements (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  earned INTEGER NOT NULL CHECK (earned BETWEEN 1 AND 7)
);
INSERT INTO button_achievements SELECT user_id, earned FROM saved_button_achievements;
DROP TABLE saved_button_achievements;
PRAGMA user_version=8;
`)
	if closeErr := old.Close(); closeErr != nil {
		t.Fatal(closeErr)
	}
	if err != nil {
		t.Fatal(err)
	}

	if _, err := db.Restore(ctx, snapshot, t.TempDir(), user, now); err != nil {
		t.Fatal(err)
	}
	restored, err := db.CurrentCounters(ctx, user.ID)
	if err != nil || restored.Clicks != 1 || restored.ButtonAchievements != ReconnectedPlug|SlackCordClick {
		t.Fatalf("restored version 8 progress = %+v, %v", restored, err)
	}
	migrated, err := Open(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	defer migrated.Close()
	clicked, err := migrated.IncrementWithButtonAchievements(ctx, user.ID, now, Rebound|HoldThatThought)
	if err != nil || clicked.Clicks != 2 || clicked.ButtonAchievements != ReconnectedPlug|SlackCordClick|Rebound|HoldThatThought {
		t.Fatalf("migrated version 8 progress = %+v, %v", clicked, err)
	}
}
