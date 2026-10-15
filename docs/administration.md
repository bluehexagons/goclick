# Administration

Sign in with an administrator account and open `/admin`, or follow **Admin**
from the game's account navigation. Every panel and API request authenticates
the session and checks the current database role. Guests receive 401; players
receive 403. Signup cannot grant admin access. Admin sessions expire after at
most eight hours, and sensitive backup operations require the current password.

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
its actual service account and database path as described in [migration.md](migration.md),
then run that binary as the service account with `-database` and `-username`.
The container includes `/app/goclick-admin`:

```bash
docker exec CONTAINER /app/goclick-admin -database /data/goclick.db -username YOUR_USERNAME
```

Role changes are deliberately operator-controlled in this release. The panel
provides player inspection and recovery; it does not expose account deletion,
password editing, or role changes over HTTP.

## Player statistics and activity

The overview shows players, administrators, all-time clicks, players who clicked
in the past 24 hours, recent click events, active sessions, and daily clicks for
the past seven UTC days. The player list supports username/email search,
pagination, and sorting by last click, clicks, or username. A player detail
panel shows account timestamps, email, current counters, streaks, last recorded
sign-in, recorded activity, and paginated archived Rails entities from either
import format. JSON archive rows identify their source and show omitted row timestamps as unavailable.

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

**Restore or migrate a database** accepts a full version-2, version-3, or version-4
Go Click SQLite snapshot or a Rails primary SQLite database, up to 128 MiB. It
also accepts the Rails admin JSON export with entities, up to 16 MiB. Enter the
current administrator's password and type
`RESTORE` to confirm. Password attempts are rate limited. JSON endpoints retain
their 8 KiB body limit; restore uses a separately bounded multipart upload.

The server checks supported schema objects, integrity, foreign keys, field
types, password-hash format/cost, and timestamps before changing live data.
For Go Click backups, extra tables, triggers, views, or incompatible schemas
are rejected. The
snapshot must contain at least one administrator; to recover an older snapshot
without an admin, grant a role on an isolated copy with the operator command
before uploading it. Original recovery files should remain untouched.

Rails databases normally have SQLite `user_version=0`; this does not make them
Go Click backups. The server recognizes the Rails credential schema and imports
data into an isolated fresh Go Click database using the migration validator.
Only a validated snapshot of that trusted schema reaches the live restore
transaction. Original Rails tables, triggers, and refresh-token digests are
never copied. Rails SQLite preserves passwords and roles, and must contain an
administrator. Go Click backups still require a supported schema version.

For JSON replacement, the form requires a username from the export, a new
8–72-byte password, and its confirmation. The selected imported account receives
that password and administrator access; other imported accounts require
operator-set passwords. JSON cannot recover old passwords. See
[migration.md](migration.md) for the access plan and archive limitations.

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
importers before restoring. Restored admin flags become authoritative: the
initiating admin may no longer exist or hold that role. After success, sign in
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
| POST | `/api/admin/import/rails` | Multipart `password`, `confirmation=IMPORT`, `backup`; Rails SQLite or JSON |
| POST | `/api/admin/backups/restore` | Multipart `password`, `confirmation=RESTORE`, `backup`; JSON additionally requires `admin_username`, `admin_password`, `admin_password_confirmation` |

Mutations keep the server's cross-origin protection and security headers.
Downloads and admin pages use `Cache-Control: no-store`. Audit history records
operator grants/revocations, successful exports/restores, failed password
verification, and failed restore/import attempts, imports, and operator password setup. It contains no credentials or
uploaded contents. The process log also records successful recovery and its
snapshot filename, providing a record outside the restored player data.

## Import legacy players

The recovery panel accepts a primary Rails SQLite database (128 MiB maximum)
or the old admin JSON download (16 MiB maximum) with **Fetch User Entities**
enabled. Enter your current password and type `IMPORT`. The server detects the
format, saves a private pre-import snapshot, then merges in one transaction.
Conflicts abort the entire import; current players are never overwritten or
renumbered. Import uploads use the same bounded multipart and password checks
as restore. Successful imports and their audit event commit together.

Original Rails IDs commonly collide with a newly created Go Click admin. For a
first migration that replaces current players, use **Restore or migrate a
database** and confirm `RESTORE`. Merge conflicts return HTTP 409 with a link
to this separate replacement option. The host importer against a fresh target
remains available as described in [migration.md](migration.md).

SQLite preserves existing passwords. JSON only carries progress and the fields
present in the download. Newly imported JSON accounts cannot sign in until an
operator sets a new password with `cmd/admin -password-stdin`; an exact matching
existing account keeps its current password. Host password changes revoke
sessions, are audited, and leave the admin role unchanged. There is no public
account-claim endpoint.
