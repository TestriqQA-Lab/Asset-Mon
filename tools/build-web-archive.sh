#!/usr/bin/env bash
# tools/build-web-archive.sh
#
# Build the archive uploaded to Hostinger's "Deploy Web App" for the Next.js front end.
# The API's archive is built by tools/build-deploy-archive.sh; this deliberately mirrors
# its shape, because that shape is the one the panel has actually accepted.
#
# Two things are decided here and nowhere else:
#
#   - NEXT_PUBLIC_* values are compiled into the client bundle at build time. Setting
#     them in the hosting panel afterwards does nothing. apps/web/.env.local holds
#     localhost values for development, so this sets them explicitly rather than
#     trusting that file to be absent; a shell variable wins over .env.local.
#   - The build runs here, not on the host. `next build` needs the dev dependencies and
#     more memory than a shared plan will happily give.
#
# Usage:
#   bash tools/build-web-archive.sh [output-path]
#
# Default output: dist-deploy/assetmon-web.tar.gz (+ .zip, gitignored)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/dist-deploy/assetmon-web.tar.gz}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

API_URL="${NEXT_PUBLIC_API_URL:-https://assetm-api.cinuteinfomedia.com}"
SITE_URL="${NEXT_PUBLIC_SITE_URL:-https://assetm.cinuteinfomedia.com}"

hdr(){ printf '\n\033[1m%s\033[0m\n' "$1"; }
ok() { printf '\033[32m  ✓\033[0m %s\n' "$1"; }

cd "$ROOT"

hdr "1. Build the web app"
echo "   NEXT_PUBLIC_API_URL  = $API_URL"
echo "   NEXT_PUBLIC_SITE_URL = $SITE_URL"
rm -rf apps/web/.next
NEXT_PUBLIC_API_URL="$API_URL" NEXT_PUBLIC_SITE_URL="$SITE_URL" \
  npm -w @assetmon/web run build >/dev/null
[ -f apps/web/.next/standalone/apps/web/server.js ] || {
  echo "  no standalone server.js — is output: 'standalone' still set in next.config.js?"
  exit 1
}
ok "next build produced a standalone server"

# The URLs are baked in, so a stale build is indistinguishable from a correct one until
# the deployed app quietly talks to localhost. Check the bundle rather than trusting the
# environment that was passed in.
hdr "2. Confirm the baked-in URLs"
grep -rq "$(printf '%s' "$API_URL" | sed 's#https\?://##')" apps/web/.next/static \
  || { echo "  the client bundle does not contain $API_URL"; exit 1; }
if grep -rqE "localhost:(4000|4001|3000)" apps/web/.next/static; then
  echo "  a development URL leaked into the client bundle:"
  grep -rlE "localhost:(4000|4001|3000)" apps/web/.next/static | head -5
  exit 1
fi
ok "client bundle carries the production API URL and no localhost"

hdr "3. Stage the deploy tree"
# Same reasoning as the API archive: Hostinger keeps the output directory, node_modules
# and package.json, and discards everything else — so the whole application lives under
# dist/. The standalone output nests itself at its workspace path
# (standalone/apps/web/…), and server.js resolves everything from its own __dirname, so
# flattening that one level is safe and keeps the entry file at dist/server.js.
mkdir -p "$STAGE/dist"
cp -r apps/web/.next/standalone/apps/web/. "$STAGE/dist/"
# next build leaves these two out of standalone; without them every asset 404s and the
# page renders unstyled.
mkdir -p "$STAGE/dist/.next"
cp -r apps/web/.next/static "$STAGE/dist/.next/static"
[ -d apps/web/public ] && cp -r apps/web/public "$STAGE/dist/public"
# standalone's pruned node_modules is deliberately NOT shipped. Hostinger packages a
# deployment as "the output directory, plus node_modules, plus package.json", and a
# second node_modules nested inside the output directory made packaging fail silently:
# the build log ended cleanly after the build script and no version was ever produced.
# The API archive, which deploys reliably, ships no node_modules either — the host
# installs from the manifest, and server.js resolves `next` by walking up to it. This
# also takes the archive from 23 MB to about 3 MB.
# standalone copies the repo's root manifest, which declares workspaces and a postinstall
# that generates the Prisma client. Neither belongs here, and step 4 writes the real one.
rm -f "$STAGE/dist/package.json"
ok "staged $(find "$STAGE" -type f | wc -l | tr -d ' ') files under dist/"

hdr "4. Write a flat app manifest (archive only)"
# The panel identifies the project from the root package.json. A manifest with no
# dependencies reads as "no framework" and is rejected outright — that is what the API
# archive hit. Declaring the real runtime dependencies makes it recognisably Next.js.
#
# @assetmon/shared is deliberately absent: transpilePackages compiles it into the
# bundle, so there is no module to resolve at runtime and a `file:` link would only
# point at a directory that never reaches the host.
STAGE_PKG="$STAGE/package.json" WEB_PKG="apps/web/package.json" node -e '
  const fs = require("fs");
  const web = JSON.parse(fs.readFileSync(process.env.WEB_PKG, "utf8"));

  const deps = {};
  for (const [name, range] of Object.entries(web.dependencies)) {
    if (name.startsWith("@assetmon/")) continue;
    deps[name] = range;
  }

  fs.writeFileSync(process.env.STAGE_PKG, JSON.stringify({
    name: "assetmon-web",
    version: web.version,
    private: true,
    main: "dist/server.js",
    scripts: {
      // The standalone server is prebuilt and shipped; there is nothing to compile
      // here, and no next CLI to compile it with.
      build: "echo \"dist is prebuilt and shipped in this archive; nothing to build\"",
      start: "node dist/server.js",
    },
    dependencies: deps,
    engines: { node: ">=20.19" },
  }, null, 2) + "\n");

  console.log("   dependencies: " + Object.keys(deps).length);
'
ok "root manifest declares next, main and start both -> dist/server.js"

hdr "5. Resolve a lockfile for that manifest"
( cd "$STAGE" && npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null 2>&1 ) \
  && ok "package-lock.json generated" \
  || { printf '  \033[33m!\033[0m could not resolve a lockfile (offline?); shipping without one\n'; rm -f "$STAGE/package-lock.json"; }

hdr "6. Pack"
mkdir -p "$(dirname "$OUT")"
ZIP="${OUT%.tar.gz}.zip"
rm -f "$OUT" "$ZIP"

( cd "$STAGE" && tar -czf "$OUT" -- * )
if tar -tzf "$OUT" | grep -q '\\'; then
  echo "  tar contains backslash paths -- it will not extract correctly"
  exit 1
fi
ok "tar.gz: no backslash paths, no ./ prefix"

# Written with Python's zipfile rather than Compress-Archive, which emits backslash
# separators on Windows; those extract on Linux as files with backslashes in the name.
STAGE_DIR="$STAGE" ZIP_OUT="$ZIP" python - <<'PY'
import os, zipfile
stage, out = os.environ['STAGE_DIR'], os.environ['ZIP_OUT']
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _dirs, files in os.walk(stage):
        for f in files:
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, stage).replace(os.sep, '/'))
with zipfile.ZipFile(out) as z:
    names = z.namelist()
    assert not any('\\' in n for n in names), 'backslash paths in zip'
    assert 'package.json' in names, 'package.json is not at the zip root'
    assert 'dist/server.js' in names, 'dist/server.js is not where the entry file points'
    print('   zip entries: %d' % len(names))
PY
ok "zip written"

printf '\n\033[1mArchives:\033[0m\n  %s (%s)\n  %s (%s)\n' \
  "$ZIP" "$(du -h "$ZIP" | cut -f1)" "$OUT" "$(du -h "$OUT" | cut -f1)"
cat <<EOF

Hostinger settings (mirroring the API app, which these were proven against):
  Root directory   ./
  Output directory dist
  Entry file       server.js
  Node             24.x
  Build command    npm run build     (a no-op echo)

The app talks to $API_URL, which is compiled in. Changing it means
rebuilding this archive, not editing an environment variable in the panel.
EOF
