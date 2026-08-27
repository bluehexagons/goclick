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

Back up both source and target databases before importing. The importer reads
the Rails source through one consistent read-only snapshot and writes the Go
target in one transaction.

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

## Import on an infra_tools target

Deploy once so infra_tools creates the service account, release, and persistent
data directory. For a deployment named `app.example.com`, the default paths are:

```text
service: app-app_example_com-server.service
release: /var/www/app_example_com
data:    /var/www/.infra_tools_shared/app_example_com/server/data
```

Copy the Rails primary database to the target without placing it in the release
tree, then stop Go Click and make the migration input readable only by its
service account:

```bash
sudo systemctl stop app-app_example_com-server.service
sudo install -o app-app_example_com-server -g app-app_example_com-server -m 600 \
  /path/to/production.sqlite3 \
  /var/www/.infra_tools_shared/app_example_com/server/rails-production.sqlite3
```

If a Go Click database already exists, preserve it before importing:

```bash
sudo cp -p \
  /var/www/.infra_tools_shared/app_example_com/server/data/goclick.db \
  /var/www/.infra_tools_shared/app_example_com/server/data/goclick.db.pre-import
```

Run the checked-in importer binary as the service account. It is transactional
and can safely be repeated when the source is unchanged:

```bash
sudo -u app-app_example_com-server \
  /var/www/app_example_com/.infra_tools/bin/migrate-rails \
  -source /var/www/.infra_tools_shared/app_example_com/server/rails-production.sqlite3 \
  -target /var/www/.infra_tools_shared/app_example_com/server/data/goclick.db
sudo systemctl start app-app_example_com-server.service
curl -fsS https://app.example.com/up
```

Verify representative migrated accounts and counters before changing public
traffic. After verification, remove the staged Rails database; retain the
original source backup and the pre-import Go Click backup according to the
site's recovery policy.
