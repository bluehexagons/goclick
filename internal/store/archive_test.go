package store

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

// This is stored Go Click data, not an input to a retired importer. Its original
// profile can differ from the account's current name, role, and password.
const historicalPlayerArchive = `{"id":42,"username":"original_player","email":null,"admin":false,"created_at":"2020-01-02T03:04:05Z","updated_at":"2021-02-03T04:05:06Z","entities":[{"id":101,"kind":"special_achievement","count":-7,"created_time":null,"modified_time":"2021-02-03T04:05:06Z"},{"id":102,"kind":null,"count":null,"created_time":null,"modified_time":null}]}`

func seedArchivedPlayer(t *testing.T, db *Store, hash string) User {
	t.Helper()
	if _, err := db.db.Exec(`INSERT INTO users(id,username,password_hash,admin,created_at,updated_at) VALUES(42,'archived_player',?,0,'2020-01-02T03:04:05Z','2022-03-04T05:06:07Z'); INSERT INTO counters(user_id,click_count,day_streak,month_streak,year_streak,last_clicked_at) VALUES(42,123,2,3,4,'2022-03-04T05:06:07Z')`, hash); err != nil {
		t.Fatal(err)
	}
	if _, err := db.db.Exec(`INSERT INTO rails_json_users(user_id,payload) VALUES(42,?)`, historicalPlayerArchive); err != nil {
		t.Fatal(err)
	}
	user, err := db.UserByID(context.Background(), 42)
	if err != nil {
		t.Fatal(err)
	}
	return user
}

func TestRestoreRejectsInvalidHistoricalArchives(t *testing.T) {
	for _, test := range []struct{ name, payload string }{
		{"duplicate key", strings.Replace(historicalPlayerArchive, `"id":42`, `"id":1,"id":42`, 1)},
		{"case alias", strings.Replace(historicalPlayerArchive, `"id":42`, `"ID":42`, 1)},
		{"unknown field", strings.Replace(historicalPlayerArchive, `"email":null`, `"password_digest":"unused"`, 1)},
		{"bad timestamp", strings.Replace(historicalPlayerArchive, `"2020-01-02T03:04:05Z"`, `"invalid"`, 1)},
		{"missing entities", historicalPlayerArchive[:strings.Index(historicalPlayerArchive, `"entities":`)] + `"entities":null}`},
		{"duplicate entity ID", strings.Replace(historicalPlayerArchive, `"id":102`, `"id":101`, 1)},
		{"negative gameplay count", strings.Replace(historicalPlayerArchive, `"special_achievement"`, `"click_count"`, 1)},
	} {
		t.Run(test.name, func(t *testing.T) {
			db, actor := adminFixture(t)
			seedArchivedPlayer(t, db, actor.PasswordHash)
			ctx := context.Background()
			now := time.Now()
			if _, err := db.Increment(ctx, actor.ID, now); err != nil {
				t.Fatal(err)
			}
			if err := db.CreateSession(ctx, []byte("current session"), actor.ID, now.Add(time.Hour), now); err != nil {
				t.Fatal(err)
			}
			snapshot, err := db.Backup(ctx, t.TempDir(), "invalid")
			if err != nil {
				t.Fatal(err)
			}
			raw, err := sql.Open("sqlite", snapshot)
			if err != nil {
				t.Fatal(err)
			}
			defer raw.Close()
			if _, err := raw.Exec(`UPDATE rails_json_users SET payload=? WHERE user_id=42`, test.payload); err != nil {
				t.Fatal(err)
			}
			if err := raw.Close(); err != nil {
				t.Fatal(err)
			}
			recovery := t.TempDir()
			if _, err := db.Restore(ctx, snapshot, recovery, actor, now); !errors.Is(err, ErrInvalidBackup) {
				t.Fatalf("invalid archive accepted: %v", err)
			}
			counters, err := db.CurrentCounters(ctx, actor.ID)
			if err != nil || counters.Clicks != 1 {
				t.Fatalf("rejected archive changed progress: %+v %v", counters, err)
			}
			if _, err := db.UserBySession(ctx, []byte("current session"), now); err != nil {
				t.Fatalf("rejected archive revoked session: %v", err)
			}
			files, err := os.ReadDir(recovery)
			if err != nil || len(files) != 0 {
				t.Fatalf("rejected archive created recovery files: %v %v", files, err)
			}
		})
	}
}
