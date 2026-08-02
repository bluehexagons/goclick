# Go Click Contribution Notes

## Scope

Go Click is the Go successor to the Minimal Clicker Rails application in
`../rails_test`. Keep the browser UI dependency-free and keep the server-side
session and database security properties intact.

## Migration Rules

- The migration source is the Rails primary SQLite database, not the Rails
  admin JSON download. The admin download intentionally omits
  `password_digest`, so it cannot preserve existing passwords.
- Keep Rails user IDs, bcrypt password hashes, timestamps, and every entity row
  during migration. The `counters` table is only the normalized gameplay
  projection; `rails_entities` is the lossless entity archive.
- Imports must remain transactional and idempotent. Never silently overwrite a
  different target user, counter set, or archived entity.
- Refresh-token digests are not portable authentication sessions and must not be
  migrated.

## Verification

Run `go test -race ./...`, `go vet ./...`, and `test -z "$(gofmt -l .)"` before
committing Go changes. Keep migration fixtures representative of the Rails
schema, including custom entity kinds and nullable entity fields.
