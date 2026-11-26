package store

import (
	"context"
	"testing"
	"time"
)

func TestClickProgressFollowsUTCDaysAndWeeks(t *testing.T) {
	db := openTestStore(t)
	user := createTestUser(t, db, "weekly")
	ctx := context.Background()
	sunday := time.Date(2026, 1, 4, 23, 59, 0, 0, time.UTC)
	for _, step := range []struct {
		at   time.Time
		want ClickProgress
	}{
		{sunday, ClickProgress{1, 1, 1, 1}},
		{sunday.Add(time.Minute), ClickProgress{3, 2, 2, 2}},
		{sunday, ClickProgress{3, 2, 2, 2}}, // Delayed receipt from before midnight.
		{sunday.AddDate(0, 0, 3), ClickProgress{13, 2, 2, 2}},
		{sunday.AddDate(0, 0, 7), ClickProgress{209, 2, 2, 2}},
		{sunday.AddDate(0, 0, 8), ClickProgress{419, 3, 2, 3}},
		{sunday.AddDate(0, 0, 15), ClickProgress{4481, 4, 2, 4}},
		{sunday.AddDate(0, 0, 30), ClickProgress{1, 1, 2, 4}},
	} {
		clicked, err := db.Increment(ctx, user.ID, step.at)
		if err != nil || clicked.Progress != step.want {
			t.Fatalf("click at %s: progress %+v, want %+v, error %v", step.at, clicked.Progress, step.want, err)
		}
		read, err := db.CurrentCounters(ctx, user.ID)
		if err != nil || read.Progress != step.want {
			t.Fatalf("read at %s: progress %+v, want %+v, error %v", step.at, read.Progress, step.want, err)
		}
	}
}

func TestVersionFiveProgressUsesClickDatesAndImportedStreak(t *testing.T) {
	db := openTestStore(t)
	user := createTestUser(t, db, "historical_week")
	ctx := context.Background()
	last := time.Date(2026, 1, 11, 22, 0, 0, 0, time.UTC)
	if _, err := db.db.Exec(`DROP TABLE button_achievements; DROP TABLE click_achievements; DROP TABLE click_progress; PRAGMA user_version=5`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.db.Exec(`INSERT INTO counters(user_id,click_count,day_streak,last_clicked_at) VALUES (?,100,3,?)`, user.ID, formatTime(last)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.db.Exec(`INSERT INTO player_activity(user_id,action,occurred_at) VALUES
			(?1,'click','2025-12-28T23:00:00Z'),
			(?1,'click','2026-01-03T00:30:00+02:00'),
			(?1,'click','2026-01-03 00:30:00'),
			(?1,'click','2026-01-04T00:30:00Z'),
			(?1,'click','2026-01-05T00:30:00Z'),
			(?1,'sign_in','2026-01-08T12:00:00Z')`, user.ID); err != nil {
		t.Fatal(err)
	}
	path := dbPath(t, db)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	upgraded, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	want := ClickProgress{RecentDays: 967, WeekStreak: 3, BestDayStreak: 4, BestWeekStreak: 3}
	read, err := upgraded.CurrentCounters(ctx, user.ID)
	if err != nil || read.Progress != want || read.Clicks != 100 || read.DayStreak != 3 {
		t.Fatalf("upgraded counters = %+v, want progress %+v and preserved counters, error %v", read, want, err)
	}
	clicked, err := upgraded.Increment(ctx, user.ID, last.Add(time.Hour))
	if err != nil || clicked.Progress != want || clicked.Clicks != 101 {
		t.Fatalf("same-day first click since upgrade = %+v, want progress %+v, error %v", clicked, want, err)
	}
}

func TestFailedClickDoesNotPersistProgress(t *testing.T) {
	db := openTestStore(t)
	user := createTestUser(t, db, "failed_progress")
	ctx := context.Background()
	sunday := time.Date(2026, 1, 4, 23, 59, 0, 0, time.UTC)
	first, err := db.Increment(ctx, user.ID, sunday)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.db.Exec(`CREATE TRIGGER fail_click BEFORE INSERT ON player_activity
		WHEN NEW.action='click' BEGIN SELECT RAISE(ABORT,'forced click failure'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Increment(ctx, user.ID, sunday.Add(time.Minute)); err == nil {
		t.Fatal("click unexpectedly succeeded")
	}
	saved, err := db.CurrentCounters(ctx, user.ID)
	if err != nil || saved.Clicks != first.Clicks || saved.Progress != first.Progress {
		t.Fatalf("failed click changed saved counters: %+v, %v", saved, err)
	}
}
