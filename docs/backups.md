# Backups and recovery

Go Click uses SQLite in WAL mode. A running database's `.db` file alone may omit
committed changes still in its `-wal` file. Use the [SQLite online backup
API](https://www.sqlite.org/backup.html), the `sqlite3` shell's `.backup` command,
or `VACUUM INTO` to produce a consistent, standalone snapshot. Do not copy a
live `.db` file with `cp`. See [SQLite's WAL documentation](https://www.sqlite.org/wal.html).

Full backups preserve user IDs, password hashes, admin flags, timestamps,
counters, the complete Rails entity archive, and session digests. Treat them
as credentials-bearing private files. A public/admin JSON user-data report is
not a substitute for a recovery backup.

Basaltwater makes a backup before replacement deployments and retains 14 copies
in a root-controlled directory. Also schedule backups between deployments,
retain copies on another host, and periodically rehearse restoration. Keep
production backups outside the service-writable directory and public web roots.

## Make and check a local snapshot

These examples use the default `data/goclick.db` from the repository root and
require the `sqlite3` CLI. Run as the database's owning account. Production
operators should substitute their managed data and private backup locations.
Use a private shell with `set -euo pipefail` so failures stop the procedure.

```bash
set -euo pipefail
umask 077
test -f data/goclick.db
mkdir -p backups
backup=$(mktemp "backups/goclick-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX.db")
sqlite3 -bail -readonly data/goclick.db ".timeout 5000" ".backup '$backup'"
test "$(sqlite3 -bail -readonly "$backup" 'PRAGMA integrity_check;')" = ok
test -z "$(sqlite3 -bail -readonly "$backup" 'PRAGMA foreign_key_check;')"
sqlite3 -bail -readonly "$backup" '
  PRAGMA user_version;
  SELECT COUNT(*) AS users FROM users;
  SELECT COUNT(*) AS counters FROM counters;
  SELECT COUNT(*) AS archived_entities FROM rails_entities;
  SELECT COUNT(*) AS json_imported_users FROM rails_json_users;
'
printf 'Verified backup: %s\n' "$backup"
```

The checks require `integrity_check` to return exactly `ok` and
`foreign_key_check` to return no rows. [Integrity checks do not check foreign
keys](https://www.sqlite.org/pragma.html#pragma_integrity_check), so both matter.
The current schema version is 5. Row counts and integrity checks do not prove
every application's value is correct; inspect representative accounts as well.
On any failure, keep the error and distinguish the failed snapshot from verified
backups. Do not apply retention deletion until the new snapshot is verified.

To inspect user data, use an isolated backup or read-only connection and select
explicit columns rather than `SELECT *` from users or sessions:

```bash
sqlite3 -bail -readonly "$backup" '
  SELECT id, username, admin, created_at, updated_at FROM users ORDER BY id LIMIT 20;
  SELECT user_id, click_count, day_streak, month_streak, year_streak, last_clicked_at
    FROM counters ORDER BY user_id LIMIT 20;
  SELECT user_id, kind, COUNT(*) FROM rails_entities
    GROUP BY user_id, kind ORDER BY user_id, kind LIMIT 20;
'
```

## Rehearse before restoring production

Copy the chosen verified backup into a private temporary directory. Run the
same release you intend to restore with `GOCLICK_DATABASE` pointing to that
copy and `GOCLICK_ADDR` bound to an unused loopback port. Verify `/up`, old
passwords, intended administrator flags, click/streak totals, custom entity
kinds, and nullable archive fields. This instance is disposable: signing in or
clicking changes the rehearsal copy. Stop it and discard the copy afterward.

Never rehearse against the production database or original backup. Newer schema
versions are rejected by the server; restore with a compatible binary. Startup
table/column checks alone do not establish that an untrusted upload is safe.

## Restore while stopped

1. Stop the service and confirm all Go Click processes and other
   database writers are stopped. For Basaltwater, use the exact systemd unit
   and account described in [the service details](administration.md#basaltwater-service-details). Keep
   traffic in maintenance mode until recovery is verified.
2. Make and verify a fresh pre-restore backup with the procedure above, and
   retain its path independently from the chosen recovery snapshot.
3. Set `backup` to the chosen recovery file and stage a private copy beside the
   live database. The following block assumes a version-5 Go Click snapshot:

```bash
test -f "$backup"
restore=$(mktemp data/.goclick-restore-XXXXXX.db)
cp -- "$backup" "$restore"
chmod 600 "$restore"
test "$(sqlite3 -bail -readonly "$restore" 'PRAGMA integrity_check;')" = ok
test -z "$(sqlite3 -bail -readonly "$restore" 'PRAGMA foreign_key_check;')"
test "$(sqlite3 -bail -readonly "$restore" 'PRAGMA user_version;')" = 5
sqlite3 -bail "$restore" 'PRAGMA journal_mode=DELETE; DELETE FROM sessions;'
```

Removing sessions prevents recovery from reactivating credentials that were
logged out or revoked after the snapshot. Users sign in again. The original
backup remains unchanged. Check admin access in rehearsal: restoration also
restores the snapshot's role assignments.

4. With every writer still stopped, preserve the original database and any
   sidecars together, then move the staged file into place on the same filesystem:

```bash
rollback=$(mktemp -d data/.goclick-pre-restore-XXXXXX)
for suffix in '' -wal -shm -journal; do
  if test -e "data/goclick.db$suffix"; then
    mv -- "data/goclick.db$suffix" "$rollback/"
  fi
done
mv -- "$restore" data/goclick.db
```

Run file operations as the service account, or set the installed file's ownership
to that account before restart. Existing production data directories must remain
owned and writable by the service account; Go Click preserves their permissions.
Never delete or move WAL sidecars while any database connection is open.

5. Restart Go Click, verify health and representative user/admin access, and
   resume traffic. Retain the verified pre-restore snapshot and preserved
   original file set until recovery is accepted. If any step fails, keep the
   service stopped and use that pre-restore snapshot through the same staged
   procedure. Do not combine an old `.db` with a newer database's sidecars.

The admin panel also supports restore without replacing the live database file.
It pauses this server's HTTP requests, validates the staged upload, saves a
pre-restore snapshot, and copies known data columns into the trusted schema in
one transaction. Existing audit history is retained, and all sessions are
revoked. A failed transaction leaves live data intact. Version-2, version-3, version-4, and version-5
snapshots are supported; the snapshot must contain an administrator. Other
service instances and other database writers must be stopped before panel recovery.
See [administration](administration.md) for password verification, upload limits,
and recovery-snapshot locations. The stopped-service procedure above remains
available when no administrator can sign in.

Every saved click adds an activity row. Activity and audit history have no
automatic retention policy. Historical pre-import and current pre-restore
recovery snapshots are not automatically pruned. Monitor both database and backup-directory growth;
the admin panel's **Backups & recovery → Storage** view reports allocation,
history counts, and local recovery snapshot file sizes without modifying data.
Exports can exceed the panel's 128 MiB upload limit; use the stopped-service
restore procedure for those snapshots. Any future activity retention policy
must account for the admin charts and history that query those rows.
