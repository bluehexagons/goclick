# Go Click server

The Go server hosts the game and stores accounts, sessions, and progress in
SQLite. It embeds the frontend and uses a pure-Go SQLite driver and Go's
bcrypt implementation.

## Run it

Go 1.27.4 or newer is required.

```bash
go run ./cmd/server
```

Open <http://localhost:8080>. The database is created at `data/goclick.db`.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `GOCLICK_ADDR` | `:8080` | HTTP listen address |
| `GOCLICK_DATABASE` | `data/goclick.db` | SQLite database path |
| `GOCLICK_SECURE_COOKIES` | `false` | Set `true` whenever the public site uses HTTPS |
| `GOCLICK_TRUST_PROXY` | `false` | Trust `X-Real-IP` only from a loopback reverse proxy |
| `GOCLICK_BACKUP_DIR` | `backups` beside the database | Private directory for automatic pre-restore recovery snapshots |
| `GOCLICK_CLICKS_PER_MINUTE` | `320` | Online click attempts per account per minute; 0 selects the default |
| `GOCLICK_CLICKS_PER_IP_MINUTE` | `360` | Online click attempts per client IP per minute; 0 selects the default |
| `GOCLICK_PASSWORD_CONCURRENCY` | `0` (automatic) | Simultaneous HTTP password operations; automatic uses half the Go CPUs, rounded down, with a minimum of 1 and maximum of 4. Explicit values: 1–64 |

The server should be behind an HTTPS reverse proxy in production. With
`GOCLICK_TRUST_PROXY=true`, it accepts Nginx's `X-Real-IP` only when the TCP
peer is loopback; forwarded headers from direct clients are ignored. Apply an
additional client-IP rate limit at the proxy for defense in depth.

## Retired Rails migration

Rails migration is complete, and current releases no longer include the importer
or accept Rails SQLite/JSON uploads. Existing migrated accounts, passwords,
counters, and archived entities remain supported, including in Go Click backups.
For a remaining legacy installation, use the pinned intermediate release in
[`migration.md`](migration.md), then upgrade to the current version.

## API

Authentication uses a random, hashed server-side session in an `HttpOnly`,
`SameSite=Strict` cookie.

JSON identifiers (`id` and `user_id`) are decimal strings so clients preserve
the full positive 64-bit range, including IDs from restored databases. Counters
and aggregate statistics remain JSON numbers.

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/auth/signup` | Create an account and session |
| `POST` | `/api/auth/login` | Sign in with username or email |
| `DELETE` | `/api/auth/logout` | Revoke the current session |
| `POST` | `/api/auth/renew` | Extend the current cookie; requires `X-GoClick-User-ID` |
| `GET` | `/api/me` | Read the current user |
| `GET` | `/api/game` | Read `{ "user": ..., "counters": ... }` for one authenticated account |
| `GET` | `/api/clicks` | Read click and streak counters |
| `POST` | `/api/clicks` | Add one click and update streaks |
| `POST` | `/api/button-achievements` | Record a plug reconnect or outlet reset |
| `GET` | `/up` | Health check |

The `/api/clicks` and `/api/game` counters include a `progress` object with `week_streak`,
`best_day_streak`, `best_week_streak`, and `recent_days`. The last field
is a 14-bit activity mask, with the last saved click's UTC date in bit zero
and earlier dates in increasing bit positions. The `achievements` object contains
capped period click totals, a mask of UTC hours played that day, capped total
active days and months, and a mask of earned period badges.
The `earned_badges` array lists the IDs of all achievements earned by the
authenticated account. The `button_achievements` mask contains bits 1 for a
reconnect, 2 for a saved slack-cord click, 4 for an outlet reset, 8 for Rebound,
and 16 for Hold that Thought.

The browser rechecks the game snapshot when it regains focus. A later return
supersedes an older read still in flight. Changing accounts also updates an open
Options dialog and clears local-save replacement consent. Click
requests include `X-GoClick-User-ID` with the displayed account's ID; if the
shared session changed in another tab, the server returns HTTP 409 with code
`account_changed` without adding a click. The browser then refreshes the account
without replaying the rejected click. API clients may send this header for the
same protection; clients that omit it use the current session's account.
Button achievement requests require `X-GoClick-User-ID` and accept
`{"interaction":"reconnect"}` or `{"interaction":"reset"}`. Successful clicks can
award gesture badges through
`X-GoClick-Button-Achievements` (a decimal mask of bits 2, 8, and 16).
Older clients can still use `X-GoClick-Cord-Slack: 1` for the slack badge.
These client-reported interactions award cosmetic badges.
Returning online with an expired session clears cached account progress while
preserving the independent local save.

JSON request bodies are limited to 8 KiB. Legacy Rails paths (`/auth/login`,
`/auth/signup`, `/me`, and `/entities/*`) are retained as transition aliases,
but authentication is cookie-based and old JWTs are not accepted. The Rails
`/auth/refresh` and `/admin/*` endpoints are not compatibility aliases; Go Click
has its own admin API described below.

Login accepts an optional `identifier_type`: `auto` (the default), `username`,
or `email`. Automatic lookup rejects identifiers shared by different accounts.
For overlapping migrated usernames and emails, open **Sign-in options** on
the sign-in form and choose the identifier type. New registrations cannot
create these overlaps; existing accounts keep their identities.

## Security

- Passwords use bcrypt cost 12; unknown-user login performs the same-cost
  dummy bcrypt check. Existing migrated bcrypt hashes remain usable, and
  backup restore validates password-hash format and cost.
- Session secrets are 256-bit random values and only SHA-256 digests are stored.
- Players and administrators share a rolling 180-day inactivity window with no
  absolute session-age limit. Authenticated activity renews the server deadline
  roughly once a day. The browser renews its cookie through `/api/auth/renew`,
  coordinating renewal, login, signup, logout, and restore across tabs with Web
  Locks. Ordinary responses never set or clear session cookies, so delayed reads
  cannot erase a newer login. Renewal keeps the same token. Inactive sessions expire
  after approximately 180 days; expired or revoked sessions are never revived.
  Browsers without Web Locks retain their existing cookie until its expiry and
  then require sign-in. API clients can use authenticated response headers
  `X-GoClick-User-ID` and `X-GoClick-Session-Expires` (Unix seconds) to schedule
  renewal, and must serialize all cookie-changing requests themselves.
- The SQLite database is restricted to the service account (`0600`).
- Existing database schemas are validated before Go Click enables WAL or
  applies upgrades, preventing an accidentally selected Rails or unrelated
  database from being altered. Schema changes and their version marker commit
  together, and foreign keys remain enabled after a connection is replaced.
- Mutations use Go's standard cross-origin protection, and cookies are HttpOnly and
  `SameSite=Strict`.
- Login, signup, general requests, click submissions, public assets, and health
  checks have independent in-memory rate limits. Add proxy-level limits for
  multi-instance deployments.
- Strict body/header limits, HTTP timeouts, parameterized SQL, security headers,
  HSTS in HTTPS mode, and transactional counter updates reduce common abuse and
  consistency risks.
- Expired server-side sessions are reaped at startup and every 24 hours.
- Signing in replaces the current session transactionally. Signup also creates
  the account and its initial session together. If either operation fails before
  committing, the previous session remains valid. Shutdown waits for active
  requests to drain.

Use a dedicated, service-owned database directory in production. New directories
are created with mode `0700`; existing directory permissions are left intact.

Online play treats HTTP 429 as a cooldown: it shows a countdown, suppresses
further save requests until `Retry-After` expires, and resumes automatically.
The button still responds physically, but rejected clicks do not add progress
and are never replayed. Accepted requests already in flight still count.
The click budgets above can be tuned to the server's capacity without changing
the client. Authentication and admin limits remain separate.

A bounded, per-account timing check adds light friction to obvious automation.
At least 240 intervals over five minutes with at most 4% timing variation trigger
a 15-second pause. Gaps of 15 seconds reset the sample; multi-pointer bursts
break the regular-cadence sample. Forty-five minutes without such a break and
at least 1,200 click attempts trigger a 30-second pause. These are heuristics,
not proof of automation: nobody is banned and saved progress is untouched.
Cooldowns are logged with account ID and reason. Only server receipt times are
used, without fingerprints or extra browser telemetry. Offline play is exempt.
Determined automation can adapt its timing; this is intentionally modest friction.

Rate-limit and activity-check state is local to one process and resets on restart. A shared
concurrency budget bounds password work across signups, logins (including
unknown users), and admin password checks. Saturated requests receive HTTP 503
with `Retry-After: 1`, without queuing password work or creating accounts or
sessions. The automatic budget follows the available Go CPUs; override it with
`GOCLICK_PASSWORD_CONCURRENCY` when needed. This bounds concurrent work, not
total CPU consumption under sustained traffic. Keep aggregate authentication
limits at the reverse proxy, particularly when running multiple instances.

## Administration and recovery

Create an account through the normal signup page, then grant it admin access
from the host as the database's owning account:

```bash
go run ./cmd/admin -database data/goclick.db -username YOUR_USERNAME
```

Sign in again and follow **Admin** in the account navigation, or open `/admin`.
The operator command also accepts `-user-id` and supports `-revoke`; it refuses
to revoke the last administrator. Role changes revoke that user's sessions.
Administrators stay signed in under the same activity-based policy as players;
there is no separate eight-hour cutoff. Sensitive recovery operations still
require the current password.

The panel shows aggregate player/click statistics, seven-day click activity,
searchable player listings, counters and streaks, account details, recorded
activity, and the Rails entity archive. The recovery panel reports database
allocation, history counts, and local snapshot usage, including files too large
for panel restore. It also exports full SQLite backups and
restores validated snapshots after password verification and explicit
confirmation. Restore first saves a recovery snapshot, replaces known data in
one transaction, and revokes all sessions. Administrative operations are audited.
Restore accepts Go Click SQLite backups only. Rails migration requires the
intermediate version documented in [`migration.md`](migration.md).

Activity history starts with this release; migrated all-time counters remain
intact. [`administration.md`](administration.md) covers bootstrap
commands, the admin API, and production recovery details.

Schema 7 stores calendar achievement progress alongside recent activity and
streak records. For older accounts, Go Click uses recorded clicks and saved
streaks as evidence of past activity. Older offline saves have only their last
click and streak counters for reconstructing this progress. Upgrades preserve
accounts, sessions, counters, and archives. The panel accepts schema-2 through
schema-9 backups. Schema 8 added persisted button interaction achievements.
Schema 9 expands their mask for click gestures.

See [`backups.md`](backups.md) for full SQLite backups, data checks,
restore rehearsal, and session revocation during recovery. Deployment backups
are useful rollback points; also schedule backups for gameplay changes between
deployments.

## Container

```bash
docker build -t goclick .
docker run --read-only --tmpfs /tmp -p 8080:8080 -v goclick-data:/data goclick
```

The image enables secure cookies, so use HTTPS in front of it. For local
plain-HTTP container testing, override `GOCLICK_SECURE_COOKIES=false`.

## Deploy with Basaltwater

The repository includes a `basaltwater.json` manifest for Basaltwater. It builds the
server and admin operator binaries on the target VM, assigns a stable internal port,
keeps SQLite in Basaltwater's persistent service data directory, binds the
service to loopback, and exposes a database-aware `/up` health check. Before
each replacement deployment, Basaltwater verifies the old service is stopped,
creates a consistent SQLite backup, and retains the latest 14 copies in a
root-controlled directory that the Go Click service cannot modify.

With the current Basaltwater target-build flow, Go is detected from `go.mod`
and installed automatically when this repository is deployed:

```bash
basaltw setup server_web app.example.com deploy \
  --ssl --ssl-email admin@example.com \
  --deploy app.example.com https://github.com/bluehexagons/goclick.git
```

Update the controller's Basaltwater installation before deploying this revision:
the manifest uses `build_runtimes: ["go"]` to skip Node and Python provisioning.
Older Basaltwater versions reject this field. Node remains a development/CI
tool for refreshing the committed frontend bundles; deployment does not rebuild
them. The two release binaries are built together with `CGO_ENABLED=0`, so
application builds require no C or C++ compiler.

The first Go build still compiles the SQLite driver and can use substantial
memory. Basaltwater keeps each application's Go build and module caches in
its persistent build account home; retain those caches between deployments.
An unchanged repeat build should reuse the compiled dependencies. If a small VM
is swapping during the Go build, lower compiler parallelism with
`GOFLAGS=-p=1` and, if necessary, `GOGC=50` in the component's build `env`.
These trade CPU throughput for lower memory use; they are not needed by default.
Toolchain or dependency upgrades can cause another cold build. Setup steps such
as host package updates and backups take additional time outside the app build.

The manifest deliberately enables secure cookies. Complete the test deployment
with `--ssl`, or use `--cloudflare` and complete the tunnel setup, then browse
it over HTTPS; login cookies will not be sent back by a browser over plain HTTP.
For disposable HTTP-only testing, run the binary directly with
`GOCLICK_SECURE_COOKIES=false`; Basaltwater does not override
manifest runtime variables from the setup command.

Legacy Rails installations must migrate using the pinned intermediate version
before deploying the current release; see [`migration.md`](migration.md).
