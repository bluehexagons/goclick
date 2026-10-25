package store

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestAdminOverviewChronologicalRangesAndUTCDays(t *testing.T) {
	db := openTestStore(t)
	ctx := context.Background()
	now := time.Date(2026, 10, 24, 12, 0, 0, 500000000, time.UTC)
	fixtures := []struct {
		raw    string
		recent bool
		day    string
	}{
		{"2026-10-23T12:00:00Z", false, "2026-10-23"},
		{"2026-10-23T12:00:00.499999999Z", false, "2026-10-23"},
		{"2026-10-23T12:00:00.5Z", true, "2026-10-23"},
		{"2026-10-23T12:00:00.500000001Z", true, "2026-10-23"},
		{"2026-10-23T12:00:00.75Z", true, "2026-10-23"},
		{"2026-10-23T13:00:00+01:00", false, "2026-10-23"},
		{"2026-10-23T13:00:00.5+01:00", true, "2026-10-23"},
		{"2026-10-23 12:00:00.75", true, "2026-10-23"},
		{"2026-10-23 12:00:00", false, "2026-10-23"},
		{"2026-10-24T00:30:00+01:00", true, "2026-10-23"},
		{"2026-10-23T23:30:00-01:00", true, "2026-10-24"},
		{"2026-10-17T23:30:00-01:00", false, "2026-10-18"},
		{"2026-10-18 00:00:00", false, "2026-10-18"},
		{"2026-10-18T00:30:00+01:00", false, ""},
		{"2026-10-17T23:59:59.999999999Z", false, ""},
	}
	var wantRecent int64
	wantDays := make(map[string]int64)
	for i, fixture := range fixtures {
		user := createTestUser(t, db, fmt.Sprintf("range_%d", i))
		if _, err := db.db.Exec(`INSERT INTO counters(user_id,click_count,last_clicked_at) VALUES (?,1,?)`, user.ID, fixture.raw); err != nil {
			t.Fatal(err)
		}
		if _, err := db.db.Exec(`INSERT INTO player_activity(user_id,action,occurred_at) VALUES (?,'click',?)`, user.ID, fixture.raw); err != nil {
			t.Fatal(err)
		}
		if fixture.recent {
			wantRecent++
		}
		wantDays[fixture.day]++
		// Check each addition so one incorrect inclusion cannot cancel an
		// incorrect exclusion. The clock's local date also differs from UTC.
		t.Run(fixture.raw, func(t *testing.T) {
			overview, err := db.AdminOverview(ctx, now.In(time.FixedZone("east", 14*60*60)))
			if err != nil {
				t.Fatal(err)
			}
			if overview.ActivePlayers != wantRecent || overview.Clicks24h != wantRecent {
				t.Errorf("24h counts: players=%d clicks=%d, want %d", overview.ActivePlayers, overview.Clicks24h, wantRecent)
			}
			if len(overview.Daily) != 7 {
				t.Fatalf("daily buckets: %+v", overview.Daily)
			}
			for i, day := range overview.Daily {
				wantDate := dateKey(now.AddDate(0, 0, i-6))
				if day.Date != wantDate || day.Clicks != wantDays[wantDate] {
					t.Errorf("daily[%d]=%+v, want %s: %d", i, day, wantDate, wantDays[wantDate])
				}
			}
		})
	}
}

func TestAdminTimestampOrderingPreservesRawValuesAcrossRestore(t *testing.T) {
	db, actor := adminFixture(t)
	ctx := context.Background()
	// Ascending instants, with two equivalent values to exercise the ID tie
	// breaker. Include offsets and legacy forms accepted from native backups.
	raw := []string{
		"2026-10-23T12:00:00Z",
		"2026-10-23T12:00:00.1Z",
		"2026-10-23T12:00:00.100000000Z",
		"2026-10-23T12:00:00.100000001Z",
		"2026-10-23 12:00:00.100000002",
		"2026-10-23T13:00:00.2+01:00",
		"2026-10-23 12:00:00.75",
	}
	ids := make([]int64, len(raw))
	for i, timestamp := range raw {
		user := createTestUser(t, db, fmt.Sprintf("ordered_%d", i))
		ids[i] = user.ID
		if _, err := db.db.Exec(`INSERT INTO counters(user_id,last_clicked_at) VALUES (?,?)`, user.ID, timestamp); err != nil {
			t.Fatal(err)
		}
		// Insert the earlier sign-in last so MAX(id) also gives a wrong answer.
		if _, err := db.db.Exec(`INSERT INTO player_activity(user_id,action,occurred_at) VALUES (?,'sign_in',?),(?,'sign_in','2026-10-23T12:00:00Z')`, user.ID, timestamp, user.ID); err != nil {
			t.Fatal(err)
		}
	}
	noClicks := createTestUser(t, db, "ordered_none")
	beforeSchema, err := schemaObjects(ctx, db.db)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := db.Backup(ctx, t.TempDir(), "timestamps")
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
				if _, err := db.Restore(ctx, snapshot, t.TempDir(), actor, time.Now()); err != nil {
					t.Fatal(err)
				}
			}
			players, total, err := db.ListPlayers(ctx, "ordered_", "recent", 100, 0)
			if err != nil || total != int64(len(raw)+1) || len(players) != len(raw)+1 {
				t.Fatalf("list players: %+v, total=%d, %v", players, total, err)
			}
			for i, timestamp := range raw {
				player := players[len(raw)-1-i]
				if player.ID != ids[i] || player.LastClickedAt == nil || *player.LastClickedAt != timestamp || player.LastSignInAt == nil || *player.LastSignInAt != timestamp {
					t.Errorf("ordered player: %+v, want id=%d raw=%q", player, ids[i], timestamp)
				}
				detail, err := db.AdminPlayer(ctx, ids[i])
				if err != nil || detail.LastSignInAt == nil || *detail.LastSignInAt != timestamp {
					t.Errorf("player detail: %+v, %v, want sign-in %q", detail, err, timestamp)
				}
				var stored string
				if err := db.db.QueryRow(`SELECT last_clicked_at FROM counters WHERE user_id=?`, ids[i]).Scan(&stored); err != nil || stored != timestamp {
					t.Errorf("stored timestamp changed: %q, %v", stored, err)
				}
			}
			last := players[len(raw)]
			if last.ID != noClicks.ID || last.LastClickedAt != nil || last.LastSignInAt != nil {
				t.Errorf("unclicked player: %+v", last)
			}
			page, total, err := db.ListPlayers(ctx, "ordered_", "recent", 2, 1)
			if err != nil || total != int64(len(raw)+1) || len(page) != 2 || page[0].ID != ids[5] || page[1].ID != ids[4] {
				t.Errorf("recent pagination: %+v, total=%d, %v", page, total, err)
			}
			afterSchema, err := schemaObjects(ctx, db.db)
			if err != nil || !reflect.DeepEqual(afterSchema, beforeSchema) {
				t.Fatalf("timestamp inspection changed schema: %v", err)
			}
		})
	}
}

func TestStorageOldestTimestampIsChronological(t *testing.T) {
	for _, test := range []struct{ oldest, later string }{
		{"2026-10-23T12:00:00Z", "2026-10-23T12:00:00.75Z"},
		{"2026-10-23T12:00:00.1Z", "2026-10-23T12:00:00.100000001Z"},
		{"2026-10-23T13:00:00+01:00", "2026-10-23T12:00:00.1Z"},
		{"2026-10-23T12:00:00Z", "2026-10-23 12:00:00.000000001"},
		// The raw minimum's UTC day is October 23, but the chronological
		// minimum's local day is October 25. An exclusive +2-day ceiling
		// would wrongly exclude it; +3 includes it for the exact sort.
		{"2026-10-25T00:00:00+24:60", "2026-10-22T22:30:00-24:60"},
		{"2026-10-25T00:00:00+24:00", "2026-10-23T00:00:00.000000001-24:00"},
		{"0000-01-02T00:00:00+24:60", "0000-01-01T00:00:00Z"},
		{"0000-01-01T00:00:00+24:60", "0000-01-01T00:00:00Z"},
		{"9999-12-31T23:59:59-24:60", "9999-12-31T23:59:59.000000001-24:60"},
		{"9999-12-31T23:59:59Z", "9999-12-31T23:59:59-24:60"},
	} {
		t.Run(test.oldest+"/"+test.later, func(t *testing.T) {
			db := openTestStore(t)
			user := createTestUser(t, db, "oldest")
			if _, err := db.db.Exec(`DELETE FROM player_activity`); err != nil {
				t.Fatal(err)
			}
			if _, err := db.db.Exec(`INSERT INTO player_activity(user_id,action,occurred_at) VALUES (?,'click',?),(?,'click',?)`, user.ID, test.later, user.ID, test.oldest); err != nil {
				t.Fatal(err)
			}
			stats, err := db.Storage(context.Background())
			if err != nil || stats.OldestActivityAt == nil || *stats.OldestActivityAt != test.oldest {
				t.Fatalf("oldest: %+v, %v, want %q", stats, err, test.oldest)
			}
		})
	}
}

func TestSQLTimestampKeyPrecisionAndRange(t *testing.T) {
	db := openTestStore(t)
	for _, test := range []struct {
		a, b string
		cmp  int
	}{
		{"2026-10-23T12:00:00Z", "2026-10-23T12:00:00.000000001Z", -1},
		{"2026-10-23T12:00:00.1Z", "2026-10-23T12:00:00.100000000Z", 0},
		{"2026-10-23T12:00:00.100000001Z", "2026-10-23T12:00:00.1Z", 1},
		{"2026-10-23T13:00:00.123456789+01:00", "2026-10-23 12:00:00.123456789", 0},
		{"2026-10-23 12:00:00", "2026-10-23T12:00:00Z", 0},
		{"1969-12-31T23:59:59.999999999Z", "1970-01-01T00:00:00Z", -1},
		{"0000-01-01T00:00:00+01:00", "0000-01-01T00:00:00Z", -1},
		{"9999-12-31T23:59:59.999999998-01:00", "9999-12-31T23:59:59.999999999-01:00", -1},
	} {
		t.Run(test.a+"/"+test.b, func(t *testing.T) {
			var got int
			if err := db.db.QueryRow(`SELECT CASE WHEN goclick_time_key(?) < goclick_time_key(?) THEN -1 WHEN goclick_time_key(?) = goclick_time_key(?) THEN 0 ELSE 1 END`, test.a, test.b, test.a, test.b).Scan(&got); err != nil || got != test.cmp {
				t.Fatalf("comparison=%d, %v, want %d", got, err, test.cmp)
			}
		})
	}
	for _, fn := range []string{"goclick_time_key", "goclick_utc_date", "goclick_date_ceiling"} {
		var value any
		if err := db.db.QueryRow(`SELECT ` + fn + `(NULL)`).Scan(&value); err != nil || value != nil {
			t.Fatalf("%s(NULL)=%v, %v", fn, value, err)
		}
		for _, invalid := range []any{"invalid", 42} {
			if err := db.db.QueryRow(`SELECT `+fn+`(?)`, invalid).Scan(&value); err == nil {
				t.Errorf("%s accepted invalid timestamp %v", fn, invalid)
			}
		}
	}
}

func TestChronologicalSignInQueryKeepsUserIndex(t *testing.T) {
	db := openTestStore(t)
	rows, err := db.db.Query(`EXPLAIN QUERY PLAN SELECT occurred_at FROM player_activity WHERE user_id=? AND action='sign_in' ORDER BY goclick_time_key(occurred_at) DESC LIMIT 1`, 1)
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
	if !strings.Contains(strings.Join(plan, "\n"), "USING COVERING INDEX player_activity_sign_in (user_id=?)") {
		t.Fatalf("sign-in lookup no longer selects one user's indexed sign-ins: %v", plan)
	}
}
