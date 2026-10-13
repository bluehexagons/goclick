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

## Import on a Basaltwater target

Rehearse against a fresh test target or explicitly restore a known pre-import
backup first; idempotency makes an unchanged import repeatable, but it is not a
reset mechanism for Go-side changes. Deploy once so Basaltwater creates the
service account, release, and persistent data directory. For a deployment named
`app.example.com`, the default paths are:

```text
service: app-app_example_com-server.service
release: /var/www/app_example_com
data:    /var/www/.basaltwater_shared/app_example_com/server/data
```

Copy the Rails primary database to a root-controlled staging directory outside
both the release and service-writable data tree. Then stop Go Click and make the
migration input readable only by its service account:

```bash
sudo systemctl stop app-app_example_com-server.service &&
  sudo install -d -o root -g root -m 711 /var/lib/goclick-migration &&
  sudo install -o root -g app-app_example_com-server -m 440 \
    /path/to/production.sqlite3 \
    /var/lib/goclick-migration/rails-production.sqlite3
```

If a Go Click database already exists, preserve it outside the service-writable
tree before importing:

```bash
sudo install -d -o root -g root -m 700 /var/backups/goclick &&
  sudo test ! -e /var/backups/goclick/goclick.db.pre-import &&
  sudo sqlite3 \
    /var/www/.basaltwater_shared/app_example_com/server/data/goclick.db \
    ".backup '/var/backups/goclick/goclick.db.pre-import'" &&
  sudo chown root:root /var/backups/goclick/goclick.db.pre-import &&
  sudo chmod 600 /var/backups/goclick/goclick.db.pre-import
```

Run the checked-in importer binary as the service account. It is transactional
and can safely be repeated when the source is unchanged:

```bash
sudo -u app-app_example_com-server \
  /var/www/app_example_com/.basaltwater/bin/migrate-rails \
  -source /var/lib/goclick-migration/rails-production.sqlite3 \
  -target /var/www/.basaltwater_shared/app_example_com/server/data/goclick.db \
  && sudo rm /var/lib/goclick-migration/rails-production.sqlite3 \
  && sudo systemctl start app-app_example_com-server.service \
  && curl -fsS https://app.example.com/up
```

Verify representative migrated accounts and counters before changing public
traffic. Retain the original source backup and the root-controlled pre-import Go
Click backup according to the site's recovery policy. If the importer fails,
the command chain deliberately leaves the staged source in place and Go Click
stopped for inspection; correct the problem before retrying or restarting.

For `clicker.bluehexagons.com`, replace `app_example_com` in these paths and
unit names with `clicker_bluehexagons_com`. Do not guess the Linux account name:
Basaltwater hashes service identities longer than 31 characters. Read the actual
account with:

```bash
systemctl show app-clicker_bluehexagons_com-server.service -p User --value
```

Use that account for the staging file's group and the importer's `sudo -u`
argument. The full unit name and persistent directory are not shortened.
