#!/usr/bin/env bash
# tools/build-deploy-archive.sh
#
# Build the archive that gets uploaded to Hostinger's "Deploy Web App".
#
# The deployed tree is not the repository. npm needs the workspace root and the
# workspace manifests to resolve @assetmon/* links, but nothing else around them --
# and docs/ describes this infrastructure while tools/ holds scripts that provision
# workspaces, neither of which belongs on a production host. See "What to deploy" in
# docs/mysql-cutover-runbook.md for what is in here and why — that doc is retired, but
# its "What to deploy" section is still the record of this archive's contents. The
# Hostinger host it targeted is gone; see docs/postgres-migration-plan.md for where the
# project is now.
#
# Two things are set inside the archive only, never in the repo:
#   - a root `start` script, because Hostinger looks at the root package.json and the
#     repo's `start` lives in apps/api
#   - a no-op root `build`, because the repo's builds BOTH apps and dist ships prebuilt
#
# No .env is included. Secrets belong in the hosting panel's environment variables;
# dotenv does not override values already in the environment, so they win.
#
# Usage:
#   bash tools/build-deploy-archive.sh [output-path]
#
# Default output: dist-deploy/assetmon-api.tar.gz (gitignored)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/dist-deploy/assetmon-api.tar.gz}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

hdr(){ printf '\n\033[1m%s\033[0m\n' "$1"; }
ok() { printf '\033[32m  ✓\033[0m %s\n' "$1"; }

cd "$ROOT"

hdr "1. Build the API"
# Must happen here, not on the host: a production install has no nest/tsc/ts-node.
npm -w @assetmon/api run build >/dev/null
[ -f apps/api/dist/main.js ] || { echo "  build produced no apps/api/dist/main.js"; exit 1; }
ok "apps/api/dist built"

hdr "2. Stage the deploy tree"
# The repo's package-lock.json describes a workspace tree and does not match the flat
# manifest written in step 3, so it is not copied. A fresh lock is generated there instead.
cp package.json "$STAGE/"

# The local packages live UNDER dist/, not beside it.
#
# Hostinger deploys only the output directory and node_modules; everything else in the
# uploaded tree is discarded. With packages/ at the root, npm's file: symlinks
# (node_modules/@assetmon/db -> ../../packages/db) survived the copy while their targets
# did not, so the app died on `Cannot find module '@assetmon/db'` before it could listen
# — which is what produced a 503 behind a deployment marked Completed.
#
# dist/ is the one directory that reliably survives, so the packages go inside it.
PKG_ROOT="$STAGE/dist/packages"
mkdir -p "$PKG_ROOT/db/src" "$PKG_ROOT/shared"
cp packages/db/package.json "$PKG_ROOT/db/"
cp -r packages/db/prisma "$PKG_ROOT/db/"
cp packages/db/src/index.js packages/db/src/index.d.ts "$PKG_ROOT/db/src/"
# The generated client ships with the archive instead of being regenerated on the host.
# Under Prisma 7 it is ~13 MB of JavaScript and a WASM query compiler with no native
# binary in it, so it travels fine — and generating on the host is not an option, because
# the Prisma CLI still carries a Rust schema engine that cannot start on CloudLinux.
[ -d packages/db/src/generated ] || {
  echo "  packages/db/src/generated is missing — run: npm -w @assetmon/db run generate"
  exit 1
}
cp -r packages/db/src/generated "$PKG_ROOT/db/src/"
cp packages/shared/package.json "$PKG_ROOT/shared/"
cp -r packages/shared/src "$PKG_ROOT/shared/"

# The compiled output goes to dist/ at the archive root, not apps/api/dist. A host that
# recognises a NestJS project expects the conventional layout, and three deploys that
# only varied the declared entry file all failed the same way with a clean build log --
# so the shape of the tree, not the pointer into it, is what was being rejected.
mkdir -p "$STAGE/dist" "$STAGE/dist/scripts"
cp -r apps/api/dist/. "$STAGE/dist/"
# Source maps carry the original TypeScript. Nothing serves them -- the API registers
# no static-file middleware -- but they are of no use in production either, so they do
# not go on the host. Stack traces then point at the compiled JS, which is fine there.
find "$STAGE/dist" -name '*.js.map' -delete
find "$STAGE/dist" -name '*.tsbuildinfo' -delete
# The bootstrap CLI has to go inside dist/ for the same reason the packages do —
# nothing outside dist/ reaches the host. It loads sibling modules as
# `require('../dist/…')`, which was right when it sat beside apps/api/dist; from
# dist/scripts/ the compiled code is one level up, so those paths are rewritten here.
sed "s#require('\.\./dist/#require('../#g" apps/api/scripts/platform-bootstrap-admin.js \
  > "$STAGE/dist/scripts/platform-bootstrap-admin.js"
grep -q "require('\.\./platform/platform-audit-hash')" "$STAGE/dist/scripts/platform-bootstrap-admin.js" \
  || { echo "  bootstrap CLI require paths were not rewritten as expected"; exit 1; }
# Keep npm from installing the `prisma` CLI on the host.
#
# @prisma/client declares `prisma` as a peerDependency, and npm installs peers
# automatically. That pulls in @prisma/engines — whose postinstall downloads a Rust
# schema engine — along with Prisma Studio's react/@visx/d3 tree: measured at 297 MB
# against 79 MB without it. None of it is reachable at runtime, and putting a Rust
# binary back on CloudLinux is the one thing this archive exists to avoid.
#
# The install flags are Hostinger's to choose, not ours, so this goes in a .npmrc where
# npm will read it whatever command the panel runs.
printf 'legacy-peer-deps=true\n' > "$STAGE/.npmrc"

# Nothing native should be in the tree. A Rust engine here means the archive is built
# from a stale generated client and the host will panic again the way it used to.
if find "$STAGE" \( -name '*.node' -o -name 'query-engine*' -o -name 'libquery_engine*' -o -name 'schema-engine*' \) -print | grep -q .; then
  echo "  native engine binaries found in the staged tree:"
  find "$STAGE" \( -name '*.node' -o -name 'query-engine*' -o -name 'libquery_engine*' -o -name 'schema-engine*' \) -print
  exit 1
fi
ok "no native engine binaries in the staged tree"

ok "staged $(find "$STAGE" -type f | wc -l | tr -d ' ') files (everything under dist/)"

hdr "3. Write a flat app manifest (archive only)"
# The repo root is an npm workspace root: it declares no dependencies of its own, so
# to a host that identifies a project by reading the root package.json it looks like
# no framework at all. Hostinger's uploader rejects it outright with "Unsupported
# framework or invalid project structure".
#
# So the archive gets a manifest shaped like an ordinary NestJS app: the API's real
# dependencies at the root, with the four @assetmon/* packages resolved as `file:`
# links to the copies bundled alongside. npm links those the same way it links
# workspaces, so nothing about resolution changes at runtime.
#
# apps/api/dist stays where it is. main.ts finds the environment file at
# ../../../.env relative to __dirname, and that only lands on the archive root while
# dist sits three levels down.
STAGE_PKG="$STAGE/package.json" API_PKG="apps/api/package.json" node -e '
  const fs = require("fs");
  const api = JSON.parse(fs.readFileSync(process.env.API_PKG, "utf8"));

  const deps = {};
  for (const [name, range] of Object.entries(api.dependencies)) {
    deps[name] = name.startsWith("@assetmon/")
      ? "file:./dist/packages/" + name.slice("@assetmon/".length)
      : range;
  }

  fs.writeFileSync(process.env.STAGE_PKG, JSON.stringify({
    name: "assetmon-api",
    version: api.version,
    private: true,
    main: "dist/main.js",
    scripts: {
      // No postinstall. The generated client ships inside the archive: the Prisma CLI is
      // not installed here, and its Rust schema engine could not run on CloudLinux even
      // if it were.
      build: "echo \"dist is prebuilt and shipped in this archive; nothing to build\"",
      start: "node dist/main.js",
    },
    dependencies: deps,
    // Prisma 7 requires ^20.19 || ^22.12 || >=24. The host runs 24.
    engines: { node: ">=20.19" },
  }, null, 2) + "\n");

  console.log("   dependencies: " + Object.keys(deps).length +
    " (" + Object.keys(deps).filter(d => d.startsWith("@assetmon/")).length + " local via file:)");
'
ok "root manifest declares @nestjs/core, main and start both -> dist/main.js"

# Note for anyone reading a stack trace: main.ts looks for an environment file at
# ../../../.env relative to __dirname, which was the repo root when dist sat under
# apps/api. From dist/ at the archive root it now points above the root and finds
# nothing. That is deliberate and harmless — no .env is shipped and the host supplies
# the environment directly, which dotenv does not override.

hdr "4. Resolve a lockfile for that manifest"
# Without one the host resolves versions afresh at install time, so two deploys of the
# same archive can end up with different transitive dependencies. The .npmrc staged above
# applies here too, so the lock is resolved without the `prisma` peer — matching what the
# host will install rather than describing a different tree.
( cd "$STAGE" && npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null 2>&1 ) \
  && ok "package-lock.json generated" \
  || { printf '  \033[33m!\033[0m could not resolve a lockfile (offline?); shipping without one\n'; rm -f "$STAGE/package-lock.json"; }

hdr "5. Pack"
mkdir -p "$(dirname "$OUT")"
ZIP="${OUT%.tar.gz}.zip"
rm -f "$OUT" "$ZIP"

# Entries are written without a leading "./" — some extractors treat "./package.json"
# as nested rather than as the archive root. `*` does not match dotfiles, so .npmrc is
# named explicitly; without it the tar and the zip would ship different trees.
( cd "$STAGE" && tar -czf "$OUT" -- .npmrc * )
if tar -tzf "$OUT" | grep -q '\\'; then
  echo "  tar contains backslash paths -- it will not extract correctly"
  exit 1
fi
ok "tar.gz: no backslash paths, no ./ prefix"

# A zip as well, because that is the format Hostinger's own guide documents. Written
# with Python's zipfile rather than PowerShell's Compress-Archive, which emits backslash
# separators on Windows -- those extract on Linux as single files with backslashes in
# their names instead of a directory tree.
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
    print('   zip entries: %d, package.json at root' % len(names))
PY
ok "zip written"

printf '\n\033[1mArchives:\033[0m\n  %s (%s)\n  %s (%s)\n' \
  "$ZIP" "$(du -h "$ZIP" | cut -f1)" "$OUT" "$(du -h "$OUT" | cut -f1)"
cat <<'EOF'

On the host:
  npm install --omit=dev
  npm start

(The archive is a flat app, not a workspace, so no -w / --include-workspace-root.)

The archive ships a .npmrc with legacy-peer-deps=true so that npm does not install the
`prisma` CLI as a peer of @prisma/client and drag a Rust schema engine onto the host.
After installing, this should print nothing:

  find . \( -name '*.node' -o -name 'query-engine*' -o -name 'schema-engine*' \) -print

The database must exist and the schema must be deployed first. Migrations are run from a
workstation, never here — the Prisma CLI cannot start on CloudLinux. Set the environment
variables in the hosting panel, not in a .env file.
EOF
