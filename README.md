# Go Click

Go Click is the small, self-contained successor to
[Minimal Clicker](https://github.com/bluehexagons/rails_test). It provides the
same essentials—accounts, sign-in, clicking, and day/month/year streaks—with a
Go server and a dependency-free browser frontend.

The server uses SQLite, embeds the frontend in its binary, and has two direct
dependencies: a pure-Go SQLite driver and Go's bcrypt implementation.

The button responds immediately to presses, with a distinct held state, a
spring return, a size pulse, and release bursts. Mouse, touch/pen, Space, and Enter
activate once on release inside the button; each finger is tracked separately,
and cancelled gestures do not score. Press-down immediately compresses the solid
and deepens its amber face. Small, unboxed +1 labels wait for their save response
and show its ping, with color compared to recent timings. The button itself
sweeps teal on confirmation, violet for slow replies, and red on failure; sweep
duration follows the measured or simulated ping. Pending
clicks are shown separately from the server-confirmed total. **Options** offers
Auto, Reduced, and Full motion; Reduced keeps static feedback without movement
or flashes. Account/counter reads start together, and
graphics initialize only for a visible button, with a usable CSS fallback.
The Ping readout retains its last successful request time while saving; its
border indicates pending requests or errors. Short gaps between clicks do not
reset the indicator. Expand **Game & storage notes** for UTC streak rules,
request timing, and session/storage behavior.

**Play offline** uses one local save slot in browser storage, with optional
simulated ping and no account API requests or click rate limit. It can be opened
from the guest page or an account session. Options can download/import a
`goclick-local` version 1 JSON save, restart the slot, or explicitly replace it
with the last loaded account counters. Local clicks never upload or change
account progress. A replacement requires checking the confirmation box; invalid
imports and failed browser writes preserve the existing save. Writes use Web
Locks where available to serialize tabs, and tabs observe local save changes.
Without Web Locks, IndexedDB transactions coordinate local writes between tabs;
if neither is available, writes fail without changing the save. The chosen mode
survives reloads, so a local-mode startup skips session checks.
The page must be loaded to play; this does not install a service worker. Keep a
downloaded save before clearing browser data or moving to another device.

## Run it

Go 1.27.3 or newer is required.

```bash
go run ./cmd/server
```

Open <http://localhost:8080>. The database is created at `data/goclick.db`.

Configuration:

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
[`docs/migration.md`](docs/migration.md), then upgrade to the current version.

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
| `GET` | `/api/me` | Read the current user |
| `GET` | `/api/clicks` | Read click and streak counters |
| `POST` | `/api/clicks` | Add one click and update streaks |
| `GET` | `/up` | Health check |

The browser rechecks identity and counters when the game regains focus. Click
requests include `X-GoClick-User-ID` with the displayed account's ID; if the
shared session changed in another tab, the server returns HTTP 409 with code
`account_changed` without adding a click. The browser then refreshes the account
without replaying the rejected click. API clients may send this header for the
same protection; clients that omit it use the current session's account.

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
  and browser cookie together, roughly once a day. Renewal keeps the same token
  so parallel clicks and other tabs remain signed in. Inactive sessions expire
  after approximately 180 days; expired or revoked sessions are never revived.
- The SQLite database is restricted to the service account (`0600`).
- Existing database schemas are validated before Go Click enables WAL or
  applies upgrades, preventing an accidentally selected Rails or unrelated
  database from being altered. Schema changes and their version marker commit
  together, and foreign keys remain enabled after a connection is replaced.
- Mutations use Go's standard cross-origin protection, and cookies are HttpOnly and
  `SameSite=Strict`.
- Login, signup, total requests, and authenticated clicks have independent
  in-memory rate limits. Add proxy-level limits for multi-instance deployments.
- Strict body/header limits, HTTP timeouts, parameterized SQL, security headers,
  HSTS in HTTPS mode, and transactional counter updates reduce common abuse and
  consistency risks.
- Expired server-side sessions are reaped at startup and every 24 hours.
- Signing in replaces the current session transactionally; a failed replacement
  preserves the previous session. Shutdown waits for active requests to drain.

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
intermediate version documented in [`docs/migration.md`](docs/migration.md).

Activity history starts with this release; migrated all-time counters remain
intact. [`docs/administration.md`](docs/administration.md) covers bootstrap
commands, the admin API, and production recovery details.

Schema 5 adds a small index containing only sign-in events, so player lookups
do not scan their click history. Upgrades preserve accounts, sessions, counters,
and archives. The panel continues to accept schema-2 through schema-4 backups.

See [`docs/backups.md`](docs/backups.md) for full SQLite backups, data checks,
restore rehearsal, and session revocation during recovery. Deployment backups
are useful rollback points; also schedule backups for gameplay changes between
deployments.

## Test

```bash
go test -race ./...
go vet ./...
test -z "$(gofmt -l .)"
go mod verify
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...
```

Frontend source lives in `frontend/` as strict TypeScript ES modules. Development
uses Node.js 24.22.1+ within 24.x (LTS) or 26.12.1+ within 26.x (Current),
with Node 24.22.1 selected by `.nvmrc` and exact tools in `package-lock.json`:

```bash
npm ci
npm run build       # type-check and regenerate embedded app.js and admin.js
npm run check       # types, oxlint, oxfmt, bundle freshness, and regression tests
npm run fmt         # format TypeScript, tests, HTML, CSS, and tool configuration
```

Basaltwater on Debian is the reference development environment, following the
[shared project standards](https://github.com/bluehexagons/basaltwater/blob/main/docs/agents/project-standards.md).
The commands above also work with ordinary Go, Node and npm. Use `nvm use` to
select `.nvmrc`, or `basaltw node exec -- npm run check` on Basaltwater to select
it without changing the host's default Node version. Install dependencies in
each checkout with `npm ci`. A Go-only build uses the committed frontend bundles
and does not need Node or Basaltwater.

TypeScript checks nulls, indexed access, DOM bindings, and API response contracts;
oxlint rejects correctness issues and explicit `any`. Esbuild bundles the game
and admin entry points separately. The two generated JavaScript files are
committed, and CI rejects stale bundles, so an ordinary Go, container, or
Basaltwater build still needs only Go and serves no runtime npm dependencies.
Edit TypeScript source rather than the generated files. Rebuild before running
Go tests or restarting the dev server: assets are embedded at Go compilation.
The JavaScript tests load isolated modules compiled from that same source and
cover request ordering, recovery feedback, local saves, motion, and pointer input.

The real-browser focus regression check in
`internal/webapp/testdata/focus.browser.cjs` exports `checkFocus(page, baseURL)`.
Run it with a fresh, isolated Playwright page in Chromium and Firefox using an
existing browser test environment. It covers skip navigation, pointer/keyboard
switching, held keys, dialogs, and the hidden file picker using offline play;
it does not create an account or submit online clicks. `npm run check` runs the
unit regressions without requiring browser packages.
The companion `interaction.browser.cjs` exports `checkInteraction(page, baseURL)`
for selection, native drag prevention, gameplay dragging, and clipboard/manual
sharing. It writes only its own test stats and never reads the clipboard.
`local-save.browser.cjs` exports `checkLocalSave(page, baseURL, options)` to
verify concurrent clicks, save replacement, and reloads across two tabs in a
fresh isolated context. Run it once with the default Web Locks path and once
with `{ withoutWebLocks: true }` for the IndexedDB fallback.

The button material uses two editable Inkscape SVGs:
[`button-material.svg`](internal/webapp/web/button-material.svg) covers the whole
solid with neutral metal grain, worked facets, and engraved channels;
[`button-glow.svg`](internal/webapp/web/button-glow.svg) marks only the regions
that emit light. Both use a 260 × 144 viewBox and a 780 × 432 image size.
Keep the material grayscale (#808080 is neutral) and the glow mask white on
transparent. Match the channel coordinates between files. The game supplies
gold/copper colors and press/ping illumination, so future material variants can
replace the artwork without changing gameplay. Keep the lettering area legible.
The 3D renderer packs both images and lettering into one atlas; the CSS fallback
uses the same SVGs. Neither image blocks input, and no PNG export is required.

The game's Share button copies the current click total, UTC streaks, and a site
link by default, then opens options to customize the text. Daily and weekly click
totals are not part of the current counter summary. Offline summaries are
labeled separately. Clipboard access failures leave a selectable preview for
manual copying. Interface text and page links or images do not select or drag;
forms, errors, technical help, and administrator data retain useful copying and
editing behavior.

CI runs these checks and a deployment smoke test. Dependabot checks Go modules,
frontend tooling, GitHub Actions, and container images weekly. Keep `modernc.org/libc` at the
version required by the SQLite driver's `go.mod` when updating that driver.

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
before deploying the current release; see [`docs/migration.md`](docs/migration.md).

## License

Apache-2.0
