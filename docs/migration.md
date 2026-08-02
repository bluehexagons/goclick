# Minimal Clicker Migration

Go Click imports the Rails primary database directly. This is required for a
password-preserving cutover: Minimal Clicker's admin JSON export omits
`password_digest`, `user_id`, and some entity metadata, so it is not a complete
migration artifact.

## Prepare a source copy

Stop Minimal Clicker before copying its primary database, or use SQLite's
online backup procedure while it is running. The production database is
`rails_test/storage/production.sqlite3`; do not use the Rails cache, queue, or
cable databases.

Back up both source and target databases before importing. The importer opens
the Rails source read-only and writes the Go target in one transaction.

## Import

From the Go Click repository:

```bash
go run ./cmd/migrate-rails \
  -source ../rails_test/storage/production.sqlite3 \
  -target data/goclick.db
```

The import preserves:

- User IDs, usernames, nullable email addresses, admin flags, bcrypt password
  hashes, and Rails timestamps.
- Every Rails entity, including custom or otherwise unknown `kind` values, in
  Go Click's `rails_entities` archive.
- The four gameplay entities as the Go `counters` projection, including the
  click entity's last-modified time.

Refresh tokens are not imported. Rails stores only token digests, which cannot
be used to recreate sessions; users must sign in to Go Click after cutover.

## Safety and verification

The importer validates the required Rails tables and columns, rejects invalid
bcrypt hashes, rejects negative canonical counters, and fails instead of
overwriting different target records. Repeating an unchanged import is safe;
an import that conflicts with Go-side changes must be resolved against a
backup rather than forced.

After importing, verify representative accounts by signing in with their old
passwords and checking click and streak totals. The Rails admin JSON endpoint
can still be used for a human-readable report, but not as the source for this
password-preserving migration.
