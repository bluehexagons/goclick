# Administration

Sign in with an administrator account and open `/admin`, or follow **Admin**
from the game's account navigation. Every panel and API request authenticates
the session and checks the current database role. Guests receive 401; players
receive 403. Signup cannot grant admin access. Players and administrators use
the same rolling 180-day inactivity window, with no absolute age cutoff while
active. Authenticated activity renews the database expiry and persistent cookie
roughly once a day. Sensitive backup operations require the current password.

## Grant access from the host

Create the account through normal signup first. Run the operator command as
an account that owns the existing database:

```bash
go run ./cmd/admin -database data/goclick.db -username YOUR_USERNAME
```

Sign in again after granting access. The command also accepts an exact user ID:

```bash
go run ./cmd/admin -database data/goclick.db -user-id 42
```

Use `-revoke` to remove access. The command refuses to remove the last admin.
Role changes are transactional, audited, and revoke the affected user's sessions.
Running a grant for an account already holding that role is a no-op. The tool
refuses to create a new database at a mistyped path.

Basaltwater builds `.basaltwater/bin/goclick-admin` alongside the server. Read
its actual service account and database path as described below,
then run that binary as the service account with `-database` and `-username`.
The container includes `/app/goclick-admin`:

```bash
docker exec CONTAINER /app/goclick-admin -database /data/goclick.db -username YOUR_USERNAME
```

Role changes are deliberately operator-controlled in this release. The panel
provides player inspection and recovery; it does not expose account deletion,
password editing, or role changes over HTTP.

## Basaltwater service details

Inspect the actual unit before running operator commands or replacing database
files. For the example deployment `app.example.com`, the default unit is
`app-app_example_com-server.service`, the release is `/var/www/app_example_com`,
and persistent data is under
`/var/www/.basaltwater_shared/app_example_com/server/data`.
Substitute your deployment name and verify these paths against its unit:

```bash
systemctl show app-app_example_com-server.service -p User -p Group -p WorkingDirectory -p Environment -p ExecStart
systemctl cat app-app_example_com-server.service
```

Use the reported account to run `.basaltwater/bin/goclick-admin` from the
release, and use the configured `GOCLICK_DATABASE` path. Do not derive the Linux
account name from the hostname: Basaltwater hashes identities longer than
31 characters. Stop that exact unit and confirm every database writer is stopped
before following the [offline recovery procedure](backups.md#restore-while-stopped).

## Player statistics and activity

The overview shows players, administrators, all-time clicks, players who clicked
in the past 24 hours, recent click events, active sessions, and daily clicks for
the past seven UTC days. The player list supports username/email search,
pagination, and sorting by last click, clicks, or username. A player detail
panel shows account timestamps, email, current counters, streaks, last recorded
sign-in, recorded activity, and paginated historical Rails entities from either
archive format. JSON archive rows identify their source and show omitted row timestamps as unavailable.
The panel displays timestamps in your browser's timezone. Legacy timestamps
without an offset are interpreted as UTC, matching the server's native backup
parser.

Signup, sign-in, and click activity is recorded transactionally with the related
operation. Activity history starts with this release; earlier clicks are still
included in all-time counters, but are not reconstructed as individual events.
Current counters and the lossless `rails_entities` migration archive are distinct.
Custom entity kinds, nullable fields, IDs, and timestamps remain preserved.
Ordinary admin JSON responses never include password hashes or session digests.

## Export and restore

**Export database** downloads a consistent SQLite snapshot made with
[SQLite's `VACUUM INTO`](https://www.sqlite.org/lang_vacuum.html).
The file includes password hashes, session digests, users, counters, archive
rows, player activity, and audit history. Store it privately; it is a recovery
artifact, not a report to share publicly.

**Restore a database** accepts a full version-2, version-3, version-4, or
version-5 Go Click SQLite snapshot, up to 128 MiB. Enter the current
administrator's password and type `RESTORE` to confirm. Password attempts are
rate limited. JSON endpoints retain their 8 KiB body limit; restore uses a
separately bounded multipart upload. Rails databases and JSON exports are no
longer accepted; see the [intermediate-version migration procedure](migration.md).

The server checks supported schema objects, integrity, foreign keys, field
types, password-hash format/cost, and timestamps before changing live data.
For Go Click backups, extra tables, triggers, views, or incompatible schemas
are rejected. The snapshot must contain at least one administrator; to recover an older snapshot
without an admin, grant a role on an isolated copy with the operator command
before uploading it. Original recovery files should remain untouched.

Before replacement, the server saves a private `pre-restore-*.db` snapshot to
`GOCLICK_BACKUP_DIR`, defaulting to `backups` beside the database. Configure a
writable service-owned directory. The successful restore response shows the
snapshot basename. Recovery files are not served as public assets and are not
automatically deleted. Operators must monitor space and manage their retention.
These service-owned snapshots supplement Basaltwater's independent protected
deployment backups; retain scheduled/off-host recovery copies too.

During restore this server quiesces HTTP requests through authentication and
execution, then restores known data columns in one SQLite transaction. It
keeps the trusted live schema and open connection rather than overwriting the
live file. Current audit history is retained and snapshot audit history is
merged. All sessions are revoked. A failed transaction rolls back data changes;
the pre-restore snapshot remains available for operator recovery.

Run one Go Click service instance during recovery, and stop other instances or
other database writers before restoring. Restored admin flags become
authoritative: the initiating admin may no longer exist or hold that role.
After success, sign in
with an administrator from the snapshot and verify player data. If access is
lost, use the host operator command or [the offline recovery runbook](backups.md).

## Storage visibility

**Backups & recovery → Storage** shows database allocation, reusable pages,
activity/audit record counts, and the count and total file sizes of local
`pre-import-*.db` and `pre-restore-*.db` recovery snapshots. Snapshot timestamps
are filesystem modification times. Symlinks, directories, unrelated files, and
SQLite sidecars are excluded. This inventory does not validate snapshot contents
or include protected deployment/off-host backups. A directory scan failure is
shown as unavailable rather than an empty inventory; details stay in server logs.

Database allocation uses SQLite's [page count and page size](https://www.sqlite.org/pragma.html#pragma_page_count),
including committed pages in WAL. WAL/SHM files consume additional physical disk
space, and compacted exports may be smaller than database allocation. The panel
flags allocation at 80% of its 128 MiB restore limit and counts local snapshot
files that actually exceed that limit. Larger snapshots remain recoverable
through the stopped-service procedure in [backups.md](backups.md).

This view is read-only. Activity and audit history and recovery snapshots are
not automatically deleted. Plan retention and off-host backups separately.

## Admin API

All endpoints below require admin authentication. Read endpoints accept
`page` (starting at 1) and `limit` (1–100, default 25) where paginated.
Identifiers in JSON responses (`id` and `user_id`) are exact decimal strings;
keep them as strings in clients and pass them unchanged in paths and filters.
The database and native backup formats retain their existing integer IDs.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/admin/overview` | Aggregate counters, active players/sessions, daily clicks |
| GET | `/api/admin/storage` | Database allocation/history counts, local recovery snapshot inventory, restore upload limit |
| GET | `/api/admin/players` | Player list; `q` search and `sort=recent\|clicks\|username` |
| GET | `/api/admin/players/{id}` | Player account/counter details |
| GET | `/api/admin/players/{id}/entities` | Paginated lossless Rails entity archive |
| GET | `/api/admin/activity` | Paginated events; optional `user_id` |
| GET | `/api/admin/audit` | Paginated administrative history |
| POST | `/api/admin/backups/export` | SQLite download; JSON `{ "password": "..." }` |
| POST | `/api/admin/backups/restore` | Multipart `password`, `confirmation=RESTORE`, `backup`; Go Click SQLite only |

Mutations keep the server's cross-origin protection and security headers.
Downloads and admin pages use `Cache-Control: no-store`. Audit history records
operator grants/revocations, successful exports/restores, failed password
verification, failed restore attempts, and operator password setup. Historical
import audit events remain visible. The history contains no credentials or
uploaded contents. The process log also records successful recovery and its
snapshot filename, providing a record outside the restored player data.
