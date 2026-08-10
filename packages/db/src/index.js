const { PrismaMariaDb } = require('@prisma/adapter-mariadb');

/**
 * Build the driver adapter that every Prisma client in this repo is constructed with.
 *
 * Prisma 7 ships no query engine: the query compiler is WebAssembly and runs inside this
 * process, and the wire is the pure-JS mariadb driver. Nothing native is loaded and no
 * child process is spawned. That is what makes the API runnable on Hostinger's shared
 * hosting, which is CloudLinux — Prisma cannot identify that distro ("Distro is
 * undefined"), falls back to its Debian engine, and every Rust build tried there died
 * with "PANIC: timer has gone away".
 *
 * Because there is no engine, a client built without an adapter has no way to reach the
 * database and throws at construction. There is exactly one place that assembles it, so
 * the pool is configured once.
 *
 * The pool settings are here rather than on the URL because `connection_limit` is a
 * Prisma parameter and the mariadb driver ignores it without complaint:
 *   - connectionLimit 3, because the Rust engine sized its pool as num_cpus * 2 + 1 and
 *     CloudLinux reports the physical machine's CPUs, so the old default was asking a
 *     shared server for tens of connections.
 *   - minimumIdle 1, NOT 0. Measured against MariaDB 11.8.8 with mariadb 3.4.5: a pool
 *     with minimumIdle 0 never opens a connection at all and every query fails with
 *     ER_GET_CONNECTION_TIMEOUT, which reads like a dead host rather than a bad option.
 *   - idleTimeout 60s, so connections are not held across an idle period.
 *
 * `overrides` exists for batch scripts that need a different pool — see
 * apps/api/scripts/consolidate-data.ts, which pins the pool to one connection so that
 * session state stays on the connection that set it.
 */
function makeAdapter(url = process.env.DATABASE_URL, overrides = {}) {
  // Not necessarily DATABASE_URL: the bootstrap CLI passes CATALOG_DATABASE_URL, so the
  // message names both rather than sending someone to check the wrong variable.
  if (!url) {
    throw new Error(
      'no database URL: pass one to makeAdapter(), or set DATABASE_URL ' +
      '(the bootstrap CLI reads CATALOG_DATABASE_URL)',
    );
  }

  const parsed = new URL(url);

  // Everything below is built from the URL's parts, so anything in its query string is
  // dropped. Saying so out loud matters here: `?connection_limit=` is the exact kind of
  // setting that looks applied and is not — see the pool note above.
  if (parsed.search) {
    const names = [...parsed.searchParams.keys()].join(', ');
    // eslint-disable-next-line no-console
    console.warn(
      `[prisma] ignoring query parameters on the database URL: ${names}. ` +
      'Pool and connection options are set in makeAdapter(), not on the URL.',
    );
  }

  const config = {
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    connectionLimit: 3,
    minimumIdle: 1,
    idleTimeout: 60,
    ...overrides,
  };

  // A URL cannot carry a unix socket path, so it is read from the environment.
  const socketPath = process.env.DATABASE_SOCKET_PATH;
  if (socketPath) {
    config.socketPath = socketPath;
  } else {
    // "localhost" is not one address, and MySQL grants are per-host. The mysql CLI reads
    // it as "use the unix socket"; this driver resolves it as a name and reaches the
    // server over IPv6, arriving as `::1`. On Hostinger the grant is for `127.0.0.1`, so
    // a URL saying localhost fails with `Access denied for user '...'@'::1'` — and
    // through the pool that surfaces as ER_GET_CONNECTION_TIMEOUT, which reads as a
    // network problem rather than a rejected login. Proven on the host: single
    // connection to localhost denied, to 127.0.0.1 accepted.
    const host = parsed.hostname;
    config.host = host === 'localhost' ? '127.0.0.1' : host;
    config.port = Number(parsed.port) || 3306;
  }

  return new PrismaMariaDb(config);
}

const prisma = require('./generated');
module.exports = { ...prisma, makeAdapter };
