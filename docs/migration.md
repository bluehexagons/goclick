# Retired Rails migration

All managed servers have migrated. Current Go Click releases no longer ship
`cmd/migrate-rails`, the admin import endpoint, or Rails SQLite/JSON conversion
in the restore panel. Current restore accepts Go Click SQLite backups only.
Existing migrated passwords, user IDs, counters, timestamps, and entity archives
are retained; no database cleanup or data conversion accompanies this removal.

If another Rails installation needs migration, use intermediate revision
[`b7ee8cb77f5503d90b430bb11435bdf40be63e44`](https://github.com/bluehexagons/goclick/tree/b7ee8cb77f5503d90b430bb11435bdf40be63e44).
Its [migration runbook](https://github.com/bluehexagons/goclick/blob/b7ee8cb77f5503d90b430bb11435bdf40be63e44/docs/migration.md)
describes the importer, validation, and cutover procedure.

Create a separate checkout to avoid downgrading a running installation:

```bash
git fetch origin
git worktree add --detach ../goclick-migration b7ee8cb77f5503d90b430bb11435bdf40be63e44
cd ../goclick-migration
```

Follow that revision's runbook using private, consistent copies of the source
Rails primary SQLite database and a separate Go Click target database. The
primary database preserves bcrypt passwords; the Rails admin JSON download
omits password hashes. Keep the original databases and verified recovery copies.
Do not point an intermediate binary at a current production database.

Rehearse the result with the current release on a disposable copy. Verify old
passwords, administrator access, user IDs, click/streak totals, custom entity
kinds, and nullable archive fields. Stop all writers before the final cutover,
then deploy the current release against the migrated Go Click database. See
[backups and recovery](backups.md) for snapshot verification and safe file
replacement, and [administration](administration.md#basaltwater-service-details)
for finding the deployed service account and database path.
