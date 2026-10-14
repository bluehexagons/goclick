# Admin implementation prerequisites

Go Click stores `users.admin`, preserves it during Rails import, and returns it
in the current user's public profile. Signup cannot set it. There are currently
no admin routes, role-management commands, or admin panels. This document scopes
the next implementation; it does not describe features available today.

## Authorization and account lifecycle

Use one server-side admin guard for every admin API route, including reads,
downloads, job status, and any transition aliases. Run authentication first:
unauthenticated requests receive 401, authenticated non-admins receive 403.
The existing session lookup reads the user and current admin flag from SQLite
on every request. Preserve that behavior so demotion takes effect on subsequent
requests. UI visibility is only a convenience; it grants no authority.

Bootstrap the first administrator through an explicit operator command targeting
an existing user ID. Never make the first signup an administrator or accept an
admin flag in public account payloads. Role changes, password changes, account
disablement, and session revocation need dedicated store transactions. Serialize
role changes so two requests cannot independently remove the last administrator.
Revoke that user's sessions when sensitive account properties change. Use a
shorter admin session lifetime and require recent authentication before role
changes, destructive user actions, and restore operations.

Keep admin routes under the existing same-origin request protection, secure
cookies, body limits, and security headers. Do not add CSRF bypasses for admin
forms or uploads. Backup uploads need a separate explicit size limit and streaming
validation rather than raising the 8 KiB limit for ordinary JSON endpoints.

## User inspection and changes

Start with paginated user listings and a read-only detail page. Use explicit
response fields: ID, username, optional email, admin status, timestamps, current
counters, archived entities, and session metadata where needed. Never include
password hashes, token digests, or raw session tokens in the panel, ordinary
JSON exports, or logs. Parameterize filters and allowlist sortable columns.

Display current `counters` separately from `rails_entities`. The archive is a
lossless migration record, including custom kinds and nullable fields; current
gameplay changes do not update it. A repair must not silently replace the
archive with a projection of current counters.

Add deliberate, audited workflows for counter repair, session revocation, and
account disablement before permanent deletion. A disabled-account field requires
a versioned database migration and authentication checks. Report conflicting
edits rather than overwriting a newer change made by another administrator.

## Audit and recovery

Record the actor, target, action, UTC timestamp, result, and request/job ID for
privileged operations. Successful data mutations and their audit event should
commit in one transaction. Record failed attempts separately without logging
credentials or uploaded contents. Protect audit retention from ordinary panel
actions; preserve an external recovery record because restoring a database can
also roll back its internal audit history.

A full SQLite backup contains password hashes and session digests, so its access
and retention rules differ from a user-data report. Store recovery copies outside
the public asset tree and, in production, outside the service-writable data tree.
Keep deployment backups separate from panel-created snapshots and scheduled
backups. An application compromise must not be able to delete every recovery
copy.

Implement backup/restore as bounded jobs with explicit status and failure states.
Use SQLite's backup API or `VACUUM INTO` for a consistent snapshot. Validate
uploaded databases in private staging, including integrity, foreign keys,
supported schema, and application-level values. Existing startup schema validation
checks table/column compatibility; it is not a validator for arbitrary uploaded
SQLite schemas, triggers, or data.

Restore must coordinate maintenance mode, stop all writers, preserve a fresh
recovery snapshot, replace the database and stale sidecars safely, reopen the
store, and revoke restored sessions before accepting traffic. The restored
database's admin flags become authoritative. Restoring a file while the live
store still holds its connection is unsafe. Keep an operator recovery path for
a restore that fails or removes the initiating administrator's access.

## Acceptance coverage

Before exposing an admin panel, verify:

- Every admin endpoint rejects guests and non-admins, including downloads and
  direct requests to routes hidden by the UI.
- Admin demotion, account disablement, and session revocation invalidate access;
  public signup cannot promote an account.
- Concurrent role edits preserve the last administrator and detect stale writes.
- Public and admin JSON responses omit password hashes and token material.
- Counter edits preserve the entity archive, and failed edits roll back both
  data changes and successful-operation audit events.
- Cross-origin mutations fail, ordinary JSON limits remain in force, and upload
  limits handle chunked requests.
- Backups taken during writes restore all users, counters, and archived entities.
  Invalid, incompatible, or interrupted restores leave a usable recovery copy.
- Recovery revokes old sessions and verifies representative passwords, admin
  access, user data, and health before traffic resumes.
