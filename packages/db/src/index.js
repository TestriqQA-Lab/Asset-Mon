const fs = require('fs');
const path = require('path');

// Point Prisma at the engine that matches the host, when its own detection cannot.
//
// On CloudLinux — which Hostinger's shared hosting runs — Prisma logs
// `Distro is "undefined". Falling back to Prisma engines built for "debian"` and loads
// libquery_engine-debian-openssl-1.1.x.so.node. That engine loads, because the host does
// have libssl.so.1.1, and then dies at runtime with "PANIC: timer has gone away", taking
// every query with it.
//
// The RHEL engine is built alongside it (see binaryTargets in prisma/schema.prisma), so
// prefer it whenever it is present and Prisma has not already been told otherwise. The
// path is derived from __dirname rather than configured, because the deployed tree lives
// under a build id that changes on every release.
// Two candidate locations, in order: whatever `prisma generate` produced on the host, and
// a copy shipped inside the deploy archive. The shipped copy exists because the host's
// generate is not guaranteed to fetch the extra target — if it does not, the first path
// is simply absent and the second one answers.
// The schema asks for the binary engine (see engineType there), so the variable to set is
// PRISMA_QUERY_ENGINE_BINARY. The library variable is set too when that file is around,
// which costs nothing and keeps this working if the engine type is ever changed back.
if (process.platform === 'linux') {
  const engines = [
    ['PRISMA_QUERY_ENGINE_BINARY', 'query-engine-rhel-openssl-1.1.x'],
    ['PRISMA_QUERY_ENGINE_LIBRARY', 'libquery_engine-rhel-openssl-1.1.x.so.node'],
  ];
  for (const [envVar, file] of engines) {
    if (process.env[envVar]) continue;
    const found = [
      path.join(__dirname, 'generated', file),
      // dist/engines/, three levels up from dist/packages/db/src
      path.join(__dirname, '..', '..', '..', 'engines', file),
    ].find((p) => fs.existsSync(p));
    if (found) {
      // The binary engine is spawned, so it has to be executable. A copy that arrived
      // through a zip may have lost that bit.
      if (envVar.endsWith('_BINARY')) {
        try { fs.chmodSync(found, 0o755); } catch { /* already fine, or not ours to change */ }
      }
      process.env[envVar] = found;
    } else if (envVar.endsWith('_BINARY')) {
      // Silence here would look identical to the override having worked.
      console.warn(`[prisma] no ${file} found; falling back to Prisma's own platform detection`);
    }
  }
}

const prisma = require('./generated');
module.exports = { ...prisma };
