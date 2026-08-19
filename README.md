# Go Click

Go Click is the small, self-contained successor to
[Minimal Clicker](https://github.com/bluehexagons/rails_test). It provides the
same essentials—accounts, sign-in, clicking, and day/month/year streaks—with a
Go server and a dependency-free browser frontend.

The server uses SQLite, embeds the frontend in its binary, and has two direct
dependencies: a pure-Go SQLite driver and Go's bcrypt implementation.

## Run it

Go 1.25 or newer is required.

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

The server should be behind an HTTPS reverse proxy in production. It deliberately
uses the TCP peer address—not a spoofable forwarded header—for IP rate limits.
If a proxy is used, apply an additional client-IP rate limit there.

## Import Minimal Clicker

Stop both applications and back up both database files first. Then point the
importer at the Rails primary production database:

```bash
go run ./cmd/migrate-rails \
  -source ../rails_test/storage/production.sqlite3 \
  -target data/goclick.db
```

The import is transactional and idempotent. It preserves user IDs, usernames,
optional email addresses, admin flags, timestamps, all four counters, and the
last click time. Every Rails entity, including custom kinds, is retained in the
`rails_entities` archive in addition to the normalized gameplay counters.
Rails `has_secure_password` stores standard bcrypt hashes, so the password
digests are copied unchanged and existing passwords work immediately—there is
no first-login reset.

Run the importer against a copy of production first and verify representative
accounts before the final cutover. An unchanged import can be repeated, but a
different existing Go Click record is reported as a conflict rather than
silently overwritten. Refresh tokens from Rails are intentionally not migrated;
users receive a new Go Click session when they sign in. See
[`docs/migration.md`](docs/migration.md) for the complete procedure and why the
Rails admin JSON export is not sufficient.

## API

Authentication uses a random, hashed server-side session in an `HttpOnly`,
`SameSite=Strict` cookie.

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/auth/signup` | Create an account and session |
| `POST` | `/api/auth/login` | Sign in with username or email |
| `DELETE` | `/api/auth/logout` | Revoke the current session |
| `GET` | `/api/me` | Read the current user |
| `GET` | `/api/clicks` | Read click and streak counters |
| `POST` | `/api/clicks` | Add one click and update streaks |
| `GET` | `/up` | Health check |

JSON request bodies are limited to 8 KiB. Legacy Rails paths (`/auth/login`,
`/auth/signup`, `/me`, and `/entities/*`) are retained as transition aliases,
but authentication is cookie-based and old JWTs are not accepted. The Rails
`/auth/refresh` and `/admin/*` endpoints are not compatibility aliases; Go Click
currently exposes the gameplay and account surface only.

## Security

- Passwords use bcrypt cost 12 to match Rails production hashes; unknown-user
  login performs the same-cost dummy bcrypt check. The Rails importer rejects
  malformed or unreasonable-cost password digests.
- Session secrets are 256-bit random values and only SHA-256 digests are stored.
- The SQLite database is restricted to the service account (`0600`).
- Mutations reject cross-site browser requests, and cookies are HttpOnly and
  `SameSite=Strict`.
- Login, signup, total requests, and authenticated clicks have independent
  in-memory rate limits. Add proxy-level limits for multi-instance deployments.
- Strict body/header limits, HTTP timeouts, parameterized SQL, security headers,
  HSTS in HTTPS mode, and transactional counter updates reduce common abuse and
  consistency risks.
- Expired server-side sessions are reaped at startup and every 24 hours.

## Test

```bash
go test -race ./...
go vet ./...
```

## Container

```bash
docker build -t goclick .
docker run --read-only --tmpfs /tmp -p 8080:8080 -v goclick-data:/data goclick
```

The image enables secure cookies, so use HTTPS in front of it. For local
plain-HTTP container testing, override `GOCLICK_SECURE_COOKIES=false`.

## Deploy with infra_tools

The repository includes an `infra.json` manifest for infra_tools. It builds the
static Go binary on the target VM, keeps the SQLite database in infra_tools'
persistent service data directory, binds the service to loopback, and exposes
`/up` for deployment health checks.

With the current infra_tools target-build flow, Go is detected from `go.mod`
and installed automatically when this repository is deployed:

```bash
infra-tools setup server_web app.example.com deploy \
  --ssl --ssl-email admin@example.com \
  --deploy app.example.com https://github.com/bluehexagons/goclick.git
```

The Rails migration remains a separate one-time operation. Back up the Rails
database and import it before switching traffic to the new service.

## License

Apache-2.0
