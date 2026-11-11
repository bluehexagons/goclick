#!/usr/bin/env bash
# Build and exercise the shipped image with disposable data. Supports Docker or Podman.
set -euo pipefail
cd "$(dirname "$0")/.."
engine="${CONTAINER_ENGINE:-docker}"
smoke_dir="$(mktemp -d)"
image="localhost/goclick-smoke:$(basename "$smoke_dir" | tr '[:upper:]' '[:lower:]')"
container="goclick-smoke-$(basename "$smoke_dir")"
cleanup() {
  "$engine" rm --force "$container" >/dev/null 2>&1 || true
  "$engine" image rm "$image" >/dev/null 2>&1 || true
  rm -rf "$smoke_dir"
}
trap cleanup EXIT
"$engine" build --force-rm -t "$image" .
test "$("$engine" image inspect --format '{{.Config.User}}' "$image")" = nonroot:nonroot
"$engine" run --detach --name "$container" --read-only \
  --tmpfs /tmp --tmpfs /data:rw,mode=1777 \
  -p 127.0.0.1::8080 "$image" > /dev/null
address="$("$engine" port "$container" 8080/tcp)"
base_url="http://$address"
ready=false
for _ in {1..30}; do
  if curl --max-time 2 --fail --silent "$base_url/up" | grep -q '"status":"ok"'; then
    ready=true
    break
  fi
  if test "$("$engine" inspect --format '{{.State.Running}}' "$container")" != true; then
    break
  fi
  sleep 1
done
if test "$ready" != true; then
  "$engine" logs "$container"
  exit 1
fi
for asset in / /app.js /app.css /icons.svg /button-material.svg /button-glow.svg /background-grain.svg; do
  curl --max-time 5 --fail --silent "$base_url$asset" --output "$smoke_dir/asset"
  test -s "$smoke_dir/asset"
done
for endpoint in /api/game /api/admin/storage /admin; do
  status="$(curl --max-time 5 --silent --output "$smoke_dir/response" --write-out '%{http_code}' "$base_url$endpoint")"
  test "$status" = 401
done
"$engine" stop "$container" > /dev/null
test "$("$engine" inspect --format '{{.State.ExitCode}}' "$container")" = 0
printf 'Container smoke passed: nonroot, read-only root, assets, authorization, graceful shutdown.\n'
