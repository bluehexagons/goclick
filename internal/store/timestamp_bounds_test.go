package store

import (
	"context"
	"database/sql/driver"
	"errors"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestTimestampDateBoundsCoverAcceptedForms(t *testing.T) {
	// Include permissive forms accepted by time.Parse, not just the strict
	// RFC3339 forms emitted by Go Click. In particular, 24:60 means 25 hours.
	var raw []string
	for _, day := range []string{
		"0000-01-01", "0000-01-02", "0000-01-03", "0000-01-04", "0001-01-01",
		"1969-12-31", "1970-01-01", "2026-10-21", "2026-10-22", "2026-10-23",
		"2026-10-24", "2026-10-25", "2026-10-26", "9999-12-28", "9999-12-29", "9999-12-30", "9999-12-31",
	} {
		for _, clock := range []string{"0:00:00", "00:30:00.000000001", "23:59:59,9999999999"} {
			for _, offset := range []string{"Z", "+01:30", "-01:30", "+00:60", "-00:60", "+23:60", "-23:60", "+24:00", "-24:00", "+24:60", "-24:60"} {
				raw = append(raw, day+"T"+clock+offset)
			}
		}
		for _, clock := range []string{"00:00:00", "12:34:56.123456", "23:59:59.999999999", "23:59:59,9999999999"} {
			raw = append(raw, day+" "+clock)
		}
	}
	instants := make([]time.Time, len(raw))
	for i, value := range raw {
		var err error
		instants[i], err = parseTime(value)
		if err != nil {
			t.Fatalf("fixture %q: %v", value, err)
		}
	}
	for i, anchor := range instants {
		floor, ceiling := timestampDateFloor(anchor), timestampDateCeiling(anchor)
		for j, instant := range instants {
			if !instant.Before(anchor) && raw[j] < floor {
				t.Fatalf("floor %q for %q excludes later/equal %q", floor, raw[i], raw[j])
			}
			if !instant.After(anchor) && raw[j] >= ceiling {
				t.Fatalf("ceiling %q for %q excludes earlier/equal %q", ceiling, raw[i], raw[j])
			}
		}
	}
	for _, test := range []struct{ raw, floor, ceiling string }{
		{"2026-10-23T00:30:00Z", "2026-10-21", "2026-10-26"},
		{"0000-01-01T00:00:00Z", "", "0000-01-04"},
		{"0000-01-01T00:00:00+24:60", "", "0000-01-02"},
		{"9999-12-31T23:59:59Z", "9999-12-29", ":"},
		{"9999-12-31T23:59:59-24:60", "9999-12-31", ":"},
	} {
		instant, err := parseTime(test.raw)
		if err != nil {
			t.Fatal(err)
		}
		if floor, ceiling := timestampDateFloor(instant), timestampDateCeiling(instant); floor != test.floor || ceiling != test.ceiling {
			t.Errorf("bounds for %q: %q, %q; want %q, %q", test.raw, floor, ceiling, test.floor, test.ceiling)
		}
	}
}

func TestAdminOverviewBoundsAtCalendarEdges(t *testing.T) {
	for _, now := range []time.Time{
		time.Date(0, 1, 8, 0, 30, 0, 1, time.UTC),
		time.Date(2026, 10, 24, 0, 30, 0, 1, time.UTC),
		time.Date(9999, 12, 31, 23, 30, 0, 1, time.UTC),
	} {
		t.Run(formatTime(now), func(t *testing.T) {
			db := openTestStore(t)
			ctx := context.Background()
			user := createTestUser(t, db, "date_edges")
			if _, err := db.db.Exec(`DELETE FROM player_activity`); err != nil {
				t.Fatal(err)
			}
			since := now.Add(-24 * time.Hour)
			week := time.Date(now.Year(), now.Month(), now.Day()-6, 0, 0, 0, 0, time.UTC)
			var wantRecent int64
			wantDays := make(map[string]int64)
			for _, boundary := range []time.Time{since, week} {
				for _, delta := range []time.Duration{-time.Nanosecond, 0, time.Nanosecond} {
					instant := boundary.Add(delta)
					for _, offset := range []struct {
						text  string
						hours int
					}{{"Z", 0}, {"+24:60", 25}, {"-24:60", -25}} {
						local := instant.Add(time.Duration(offset.hours) * time.Hour)
						if local.Year() < 0 || local.Year() > 9999 {
							continue // Raw timestamps must have a four-digit year.
						}
						raw := local.Format("2006-01-02T15:04:05.999999999") + offset.text
						if _, err := db.db.Exec(`INSERT INTO player_activity(user_id,action,occurred_at) VALUES (?,'click',?)`, user.ID, raw); err != nil {
							t.Fatal(err)
						}
						if !instant.Before(since) {
							wantRecent++
						}
						wantDays[dateKey(instant)]++
						// Check each insertion to prevent wrong inclusions and
						// exclusions from cancelling at either boundary.
						overview, err := db.AdminOverview(ctx, now)
						if err != nil || overview.Clicks24h != wantRecent {
							t.Fatalf("after %q: clicks=%d, want %d: %v", raw, overview.Clicks24h, wantRecent, err)
						}
						if len(overview.Daily) != 7 {
							t.Fatalf("daily buckets: %+v", overview.Daily)
						}
						for i, day := range overview.Daily {
							wantDate := dateKey(week.AddDate(0, 0, i))
							if day.Date != wantDate || day.Clicks != wantDays[wantDate] {
								t.Fatalf("after %q: daily[%d]=%+v, want %s: %d", raw, i, day, wantDate, wantDays[wantDate])
							}
						}
					}
				}
			}
		})
	}
}

func TestTimestampBoundedHistoryPreservesRawValuesAcrossRestoreAndReconnect(t *testing.T) {
	db, actor := adminFixture(t)
	ctx := context.Background()
	raw := []string{
		"0000-01-01T00:00:00+24:60", // UTC year -1.
		"0000-01-02T00:00:00+24:60",
		"2026-10-21T23:30:00.000000001-24:60",
		"2026-10-25T00:00:00+24:60",
		"2026-10-23 12:00:00.123456789",
		"2026-10-24T0:00:00,9999999999Z",
		"9999-12-31T23:59:59-24:60", // UTC year 10000.
	}
	if _, err := db.db.Exec(`DELETE FROM player_activity`); err != nil {
		t.Fatal(err)
	}
	for _, value := range raw {
		if _, err := db.db.Exec(`INSERT INTO player_activity(user_id,action,occurred_at) VALUES (?,'click',?)`, actor.ID, value); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Date(2026, 10, 24, 0, 30, 0, 1, time.UTC)
	wantOverview, err := db.AdminOverview(ctx, now)
	if err != nil || wantOverview.Clicks24h != 5 {
		t.Fatalf("fixture overview: %+v, %v", wantOverview, err)
	}
	beforeSchema, err := schemaObjects(ctx, db.db)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := db.Backup(ctx, t.TempDir(), "bounded-timestamps")
	if err != nil {
		t.Fatal(err)
	}
	for _, stage := range []string{"existing", "reconnected", "restored"} {
		t.Run(stage, func(t *testing.T) {
			if stage == "reconnected" {
				conn, err := db.db.Conn(ctx)
				if err != nil {
					t.Fatal(err)
				}
				if err := conn.Raw(func(any) error { return driver.ErrBadConn }); !errors.Is(err, driver.ErrBadConn) {
					t.Fatalf("discard connection: %v", err)
				}
				conn.Close()
			}
			if stage == "restored" {
				if _, err := db.Restore(ctx, snapshot, t.TempDir(), actor, now); err != nil {
					t.Fatal(err)
				}
			}
			stats, err := db.Storage(ctx)
			if err != nil || stats.ActivityRecords != int64(len(raw)) || stats.OldestActivityAt == nil || *stats.OldestActivityAt != raw[0] {
				t.Fatalf("storage: %+v, %v", stats, err)
			}
			overview, err := db.AdminOverview(ctx, now)
			if err != nil || !reflect.DeepEqual(overview, wantOverview) {
				t.Fatalf("overview: %+v, %v; want %+v", overview, err, wantOverview)
			}
			rows, err := db.db.Query(`SELECT occurred_at FROM player_activity ORDER BY id`)
			if err != nil {
				t.Fatal(err)
			}
			var stored []string
			for rows.Next() {
				var value string
				if err := rows.Scan(&value); err != nil {
					t.Fatal(err)
				}
				stored = append(stored, value)
			}
			rowErr := rows.Err()
			rows.Close()
			if rowErr != nil || !reflect.DeepEqual(stored, raw) {
				t.Fatalf("stored timestamps: %q, %v; want %q", stored, rowErr, raw)
			}
			afterSchema, err := schemaObjects(ctx, db.db)
			if err != nil || !reflect.DeepEqual(afterSchema, beforeSchema) {
				t.Fatalf("history inspection changed schema: %v", err)
			}
		})
	}
}

func TestTimestampHistoryQueriesUseTimeIndex(t *testing.T) {
	db := openTestStore(t)
	for _, test := range []struct {
		name, query string
		args        []any
		indexes     []string
	}{
		{"recent clicks", `SELECT COUNT(*) FROM player_activity WHERE action='click' AND occurred_at >= ? AND goclick_time_key(occurred_at) >= goclick_time_key(?)`, []any{"2026-10-21", "2026-10-23T00:30:00Z"}, []string{"SEARCH player_activity USING INDEX player_activity_time (occurred_at>?)"}},
		{"daily clicks", `SELECT goclick_utc_date(occurred_at), COUNT(*) FROM player_activity WHERE action='click' AND occurred_at >= ? AND goclick_time_key(occurred_at) >= goclick_time_key(?) GROUP BY goclick_utc_date(occurred_at) ORDER BY 1`, []any{"2026-10-16", "2026-10-18T00:00:00Z"}, []string{"SEARCH player_activity USING INDEX player_activity_time (occurred_at>?)"}},
		{"oldest activity", `SELECT occurred_at FROM player_activity WHERE occurred_at < (SELECT goclick_date_ceiling(MIN(occurred_at)) FROM player_activity) ORDER BY goclick_time_key(occurred_at) LIMIT 1`, nil, []string{"SEARCH player_activity USING COVERING INDEX player_activity_time (occurred_at<?)", "SEARCH player_activity USING COVERING INDEX player_activity_time"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			rows, err := db.db.Query("EXPLAIN QUERY PLAN "+test.query, test.args...)
			if err != nil {
				t.Fatal(err)
			}
			defer rows.Close()
			var plan []string
			for rows.Next() {
				var id, parent, unused int
				var detail string
				if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
					t.Fatal(err)
				}
				plan = append(plan, detail)
			}
			if err := rows.Err(); err != nil {
				t.Fatal(err)
			}
			joined := strings.Join(plan, "\n")
			t.Log(joined)
			for _, index := range test.indexes {
				if !slices.Contains(plan, index) {
					t.Errorf("query lost indexed date range/anchor %q:\n%s", index, joined)
				}
			}
		})
	}
}
