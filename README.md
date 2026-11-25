# Go Click

Go Click is a browser game about pressing a button, keeping streaks, and
unlocking achievements.

**[Play Go Click on GitHub Pages](https://bluehexagons.github.io/goclick/)**

The Pages edition opens straight into the game and saves progress in your
browser. When **Options** shows **Ready to reopen offline**, you can close the
tab and reopen the game without a connection in the same browser.

Press **Click** with a mouse, touch, pen, Space, or Enter. Open **Achievements**
to see your badges and streaks, or **Options** to adjust motion, enable sound,
and download your save.

- [Player guide](docs/player.md) covers controls, saves, and progress.
- [Server guide](docs/server.md) covers accounts, configuration, and deployment.
- [Frontend development](docs/frontend.md) covers builds, browser checks, and GitHub Pages.

## Run it

Go 1.27.4 or newer is required.

```bash
go run ./cmd/server
```

Open <http://localhost:8080>. The database is created at `data/goclick.db`.

Use the Go server to host accounts and save progress across devices. See the
[server guide](docs/server.md) for configuration, containers, and deployment.

## Test

For frontend changes, use Node.js 24.22.3+ within 24.x or 26.13.1+ within 26.x.
Both are LTS lines. `.nvmrc` selects Node 24.22.3. Tooling versions are locked
in `package-lock.json`:

```bash
npm ci
npm run build       # type-check and regenerate embedded app.js and admin.js
npm run check       # types, lint, formatting, bundle freshness, regression tests
```

Then run the Go checks:

```bash
go test -race ./...
go vet ./...
test -z "$(gofmt -l .)"
go mod verify
go run golang.org/x/vuln/cmd/govulncheck@v1.10.0 ./...
```

Rebuild frontend assets **before Go tests or restarting the server** whenever
the TypeScript changes: assets are embedded at Go compilation. Commit the
regenerated JavaScript with its source. A Go-only build can use the committed
bundles and does not require Node. `npm run fmt` formats frontend source,
tests, HTML, CSS, and tool configuration.

Basaltwater on Debian is the reference development environment, following the
[shared project standards](https://github.com/bluehexagons/basaltwater/blob/main/docs/agents/project-standards.md).
Ordinary Go, Node, and npm also work. Use `nvm use` to select `.nvmrc`, or
`basaltw node exec -- npm run check` on Basaltwater without changing the host's
default Node version. Install dependencies in each checkout with `npm ci`.

[Frontend development](docs/frontend.md) describes the source layout, optional
isolated browser checks, and SVG material authoring. The regular checks require
no browser installation. Keep development/test databases disposable; preserve
existing `data/`, `backups/`, and SQLite sidecars.

CI runs these checks, a deployment smoke test, and a container build/runtime check.
Run the container check locally with `bash scripts/smoke-container.sh` (Docker),
or `CONTAINER_ENGINE=podman bash scripts/smoke-container.sh`. It uses disposable
storage and checks nonroot startup with a read-only root filesystem, public
assets, authentication guards, and graceful shutdown.

Dependabot checks Go modules,
frontend tooling, GitHub Actions, and container images weekly. Keep
`modernc.org/libc` at the version required by the SQLite driver's `go.mod` when
updating that driver.

## License

Apache-2.0
