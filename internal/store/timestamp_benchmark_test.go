package store

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

// BenchmarkTimestampHistoryQueries measures complete admin reads with old
// history spread over five years and recent mixed-format clicks. It deliberately
// uses a disposable file database and the production single-connection Store.
func BenchmarkTimestampHistoryQueries(b *testing.B) {
	for _, size := range []int{10000, 100000, 500000} {
		b.Run(fmt.Sprintf("rows=%d", size), func(b *testing.B) {
			db, err := Open(filepath.Join(b.TempDir(), "history.db"))
			if err != nil {
				b.Fatal(err)
			}
			b.Cleanup(func() { db.Close() })
			ctx := context.Background()
			now := time.Date(2026, 10, 24, 0, 30, 0, 1, time.UTC)
			user, err := db.CreateUser(ctx, "history_benchmark", nil, "benchmark-only", now)
			if err != nil {
				b.Fatal(err)
			}
			if _, err := db.db.Exec(`DELETE FROM player_activity;
				WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x+1<?)
				INSERT INTO player_activity(user_id,action,occurred_at)
				SELECT ?,'click', CASE x%3
				 WHEN 0 THEN strftime('%Y-%m-%dT00:00:00Z','2020-01-01', '+'||(x%1827)||' days')
				 WHEN 1 THEN strftime('%Y-%m-%dT01:00:00.000000001+01:00','2020-01-01', '+'||(x%1827)||' days')
				 ELSE strftime('%Y-%m-%d 00:00:00.123456','2020-01-01', '+'||(x%1827)||' days') END FROM n`, size, user.ID); err != nil {
				b.Fatal(err)
			}
			// The first two clicks straddle the recent boundary by one ns;
			// the next two exercise UTC grouping across two local dates.
			for _, raw := range []string{
				"2026-10-21T23:30:00-24:60", "2026-10-21T23:30:00.000000001-24:60",
				"2026-10-16T23:00:00-24:60", "2026-10-19T01:00:00+24:60",
				"2026-10-23T12:00:00Z", "2026-10-23 12:00:00.123456789",
				"2026-10-24T00:15:00,123456789+01:00", "2026-10-24T0:00:00Z",
			} {
				if _, err := db.db.Exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<128)
					INSERT INTO player_activity(user_id,action,occurred_at) SELECT ?,'click',? FROM n`, user.ID, raw); err != nil {
					b.Fatal(err)
				}
			}
			b.Run("overview", func(b *testing.B) {
				for b.Loop() {
					out, err := db.AdminOverview(ctx, now)
					if err != nil || out.Clicks24h != 5*128 {
						b.Fatalf("overview clicks=%d: %v", out.Clicks24h, err)
					}
				}
			})
			b.Run("storage", func(b *testing.B) {
				for b.Loop() {
					out, err := db.Storage(ctx)
					if err != nil || out.ActivityRecords != int64(size+1024) || out.OldestActivityAt == nil || *out.OldestActivityAt != "2020-01-01T00:00:00Z" {
						b.Fatalf("storage=%+v: %v", out, err)
					}
				}
			})
		})
	}
}
