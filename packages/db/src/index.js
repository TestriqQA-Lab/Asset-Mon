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
if (!process.env.PRISMA_QUERY_ENGINE_LIBRARY && process.platform === 'linux') {
  const rhel = path.join(__dirname, 'generated', 'libquery_engine-rhel-openssl-1.1.x.so.node');
  if (fs.existsSync(rhel)) process.env.PRISMA_QUERY_ENGINE_LIBRARY = rhel;
}

const prisma = require('./generated');
module.exports = { ...prisma };
