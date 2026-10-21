# Go Click Contribution Notes

## Scope

Go Click is the Go successor to the Minimal Clicker Rails application in
`../rails_test`. Keep the browser UI dependency-free and keep the server-side
session and database security properties intact.

## Historical data compatibility

- Rails migration is retired. Do not reintroduce importers or Rails SQLite/JSON
  upload conversion; point legacy installations to the pinned intermediate
  version in [docs/migration.md](docs/migration.md).
- Preserve existing migrated user IDs, bcrypt hashes, timestamps, counters,
  and entity archives. `rails_entities` and `rails_json_users` remain part of
  the native Go Click schema, backup validation, restore, and admin inspection.
- Native backup restore remains transactional and revokes all sessions.
  Preserve support for schema versions documented in the recovery runbook.

## Verification

Use the canonical commands in [README.md](README.md#test). Run
`go test -race ./...`, `go vet ./...`, and `test -z "$(gofmt -l .)"` before
committing Go changes. Frontend changes require `npm run build` and `npm run check` with the
locked tools under Node 24 (`.nvmrc`); commit the regenerated embedded bundles
with their TypeScript source. Rebuild before Go tests or restarting the server.
Keep native backup fixtures representative of existing archived data, including
custom entity kinds and nullable entity fields.

Basaltwater on Debian is the reference development environment; ordinary Go,
Node and npm work without it. Follow its shared `basaltwater-project-development`
skill when available. Preserve `data/`, `backups/` and database sidecars during
development or cleanup; use disposable databases for tests. Generated embedded
JavaScript is tracked release content, not disposable build output.
