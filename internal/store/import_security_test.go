package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestRailsRecoveryRejectsViewsAndVirtualTables(t *testing.T) {
	for _, table := range []string{"users", "entities"} {
		for _, kind := range []string{"view", "virtual table", "view with unresolved function"} {
			for _, metadata := range []string{"real metadata", "ordinary metadata spoofer", "virtual metadata spoofer"} {
				t.Run(table+"/"+kind+"/"+metadata, func(t *testing.T) {
					path, _ := railsRestoreFixture(t)
					source, err := sql.Open("sqlite", path)
					if err != nil {
						t.Fatal(err)
					}
					if strings.HasPrefix(kind, "view") {
						viewSQL := `ALTER TABLE ` + table + ` RENAME TO source_rows; CREATE VIEW ` + table + ` AS SELECT * FROM source_rows`
						if strings.Contains(kind, "unresolved function") {
							viewSQL += ` WHERE unavailable_source_function()=0`
						}
						_, err = source.Exec(viewSQL)
					} else {
						columns := "id,username,email,password_digest,admin,created_at,updated_at"
						if table == "entities" {
							columns = "id,user_id,kind,count,created_time,modified_time,created_at,updated_at"
						}
						_, err = source.Exec(`DROP TABLE ` + table + `; CREATE VIRTUAL TABLE ` + table + ` USING fts5(` + columns + `)`)
					}
					if err == nil && metadata != "real metadata" {
						createSQL := `CREATE TABLE pragma_table_list(schema TEXT,name TEXT,type TEXT)`
						if metadata == "virtual metadata spoofer" {
							createSQL = `CREATE VIRTUAL TABLE pragma_table_list USING fts5(schema,name,type)`
						}
						_, err = source.Exec(createSQL + `; INSERT INTO pragma_table_list(schema,name,type) VALUES ('main','users','table'),('main','entities','table')`)
					}
					closeErr := source.Close()
					if err != nil {
						t.Fatal(err)
					}
					if closeErr != nil {
						t.Fatal(closeErr)
					}

					ctx := context.Background()
					target := openTestStore(t)
					reason := "ordinary table"
					if _, err := target.ImportRails(ctx, path); err == nil || !strings.Contains(err.Error(), reason) {
						t.Fatalf("merge accepted executable source schema: %v", err)
					}
					var count int
					if err := target.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count); err != nil || count != 0 {
						t.Fatalf("rejected merge changed users: count=%d error=%v", count, err)
					}

					live, actor := adminFixture(t)
					if _, err := live.Restore(ctx, path, t.TempDir(), actor, time.Now()); !errors.Is(err, ErrInvalidBackup) || !strings.Contains(err.Error(), reason) {
						t.Fatalf("replacement accepted executable source schema: %v", err)
					}
					current, err := live.UserByID(ctx, actor.ID)
					if err != nil || current.Username != actor.Username || current.PasswordHash != actor.PasswordHash || !current.Admin {
						t.Fatalf("rejected replacement changed its administrator: user=%+v error=%v", current, err)
					}
				})
			}
		}
	}
}
