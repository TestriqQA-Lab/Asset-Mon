const { PrismaPg } = require('@prisma/adapter-pg');

/**
 * Build the driver adapter that every Prisma client in this repo is constructed with.
 *
 * Prisma 7 ships no query engine: the query compiler is WebAssembly and runs inside this
 * process, and the wire is the pure-JS `pg` driver. Nothing native is loaded and no child
 * process is spawned.
 *
 * That architecture was originally forced on us — Hostinger shared hosting is CloudLinux,
 * Prisma could not identify the distro ("Distro is undefined"), fell back to its Debian
 * engine, and every Rust build tried there died with "PANIC: timer has gone away". That
 * host is retired, so the Rust engine is no longer forbidden; the adapter is kept on
 * purpose instead. It ships nothing that has to match the runtime, which keeps every AWS
 * shape open (Lambda, Fargate, ECS, EC2) while the target is still undecided.
 *
 * The one cost of that choice: the adapter's error mapping is weaker than the Rust
 * engine's, so a raw `pg` error (e.g. SQLSTATE 40001) can surface where a Prisma code
 * would otherwise appear. Error-code checks therefore accept a SQLSTATE fallback — see
 * the retry in ../../apps/api/src/common/audit-hash.ts.
 *
 * Because there is no engine, a client built without an adapter has no way to reach the
 * database and throws at construction. There is exactly one place that assembles it, so
 * the pool is configured once.
 *
 * The pool settings are here rather than on the URL because `connection_limit` is a
 * Prisma parameter and the pg driver ignores it without complaint:
 *   - max 3, carried over from the MariaDB era: the Rust engine sized its pool as
 *     num_cpus * 2 + 1, which on a shared host asked for tens of connections. Still a
 *     sane ceiling, but it has not been re-measured against Postgres — treat it as a
 *     starting point, not a finding.
 *   - idleTimeoutMillis 60s, so connections are not held across an idle period.
 *   - connectionTimeoutMillis 10s, so a dead host fails as a timeout rather than hanging.
 *
 * Note there is deliberately no `minimumIdle` equivalent. The MariaDB driver needed
 * `minimumIdle: 1` because a pool with 0 never opened a connection at all and every query
 * failed with ER_GET_CONNECTION_TIMEOUT — which read like a dead host rather than a bad
 * option. node-postgres opens connections on demand, so that hazard does not exist here
 * and the setting does not transfer.
 *
 * `overrides` exists for batch scripts that need a different pool — e.g. pinning it to a
 * single connection so that session state stays on the connection that set it. It has no
 * caller today. Kept as the escape hatch rather than rediscovering the pool settings above
 * the next time a batch job needs different ones.
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
    max: 3,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 10_000,
    ...overrides,
  };

  // A URL cannot carry a unix socket path, so it is read from the environment. pg has no
  // separate socket option: it takes the socket DIRECTORY as `host` (e.g.
  // /var/run/postgresql) and derives the filename from the port.
  const socketPath = process.env.DATABASE_SOCKET_PATH;
  if (socketPath) {
    config.host = socketPath;
    config.port = Number(parsed.port) || 5432;
  } else {
    // "localhost" is not one address: it resolves over IPv6 and arrives as `::1`. The
    // MySQL reason for normalising it is gone (grants there were per-host, `user@::1` vs
    // `user@127.0.0.1`), but pg_hba.conf rules are per-address too, so a URL saying
    // localhost can match a different line than 127.0.0.1 and be rejected for reasons
    // that read as a network fault. The rewrite costs nothing, so it stays.
    const host = parsed.hostname;
    config.host = host === 'localhost' ? '127.0.0.1' : host;
    config.port = Number(parsed.port) || 5432;
  }

  return new PrismaPg(config);
}

const prisma = require('./generated');
module.exports = { ...prisma, makeAdapter };
