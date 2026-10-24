#!/usr/bin/env node
/* eslint-disable */
/**
 * Platform admin provisioning CLI.
 *
 * This is the ONLY supported way to create or reset a platform admin. There
 * is intentionally no HTTP endpoint, no signup form, and no public
 * "first-run" flow — adding a platform admin requires shell + catalog DB
 * access on the API host. Idempotent: re-running with the same `--email`
 * upserts the row, resets the password, clears any lockout, and bumps
 * tokenVersion so any open sessions on that account are invalidated. Every
 * action is recorded in PlatformAuditLog.
 *
 * Usage:
 *   npm run platform:bootstrap-admin -- --email me@example.com --password 'Sup3rSecret!' --firstName Ada --lastName Lovelace
 *   npm run platform:bootstrap-admin -- --email me@example.com   (auto-generates a strong password and prints it)
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Walk up from this file (apps/api/scripts) to the repo root and load .env
// the same way the API does at startup so DB URL / secrets are available.
const repoRoot = path.resolve(__dirname, '..', '..', '..');
require('dotenv').config({ path: path.join(repoRoot, '.env') });

const bcrypt = require('bcryptjs');
// Catalog and tenant data share one Postgres database, so there is a single client.
// Prisma 7 has no query engine, so the client is built with a driver adapter — see
// makeAdapter in packages/db/src/index.js.
const { PrismaClient, makeAdapter } = require('@assetmon/db');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function genPassword() {
  // Hand-curated alphabet keeps it copy/pasteable (no quote/backtick/zero/oh).
  // The result is guaranteed ≥10 chars and contains at least one letter and
  // one digit, so it always satisfies the platform password policy.
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const digits  = '23456789';
  const alpha   = letters + digits;
  const symbols = '!@#$%^&*+=?';
  const pick = (s) => s[crypto.randomInt(0, s.length)];
  let pw = pick(letters) + pick(digits); // guarantee a letter + a digit
  for (let i = 0; i < 12; i++) pw += pick(alpha);
  pw += pick(symbols) + pick(symbols);
  return pw;
}

function timingSafeEq(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Append a chained, tamper-evident row to PlatformAuditLog.
 *
 * Mirrors PlatformAuditService.record(): take SELECT ... FOR UPDATE on the
 * PlatformAuditCounter singleton, hash against the counter's tail, insert, then
 * advance the counter. Reading the tail with `findFirst orderBy seq desc` instead —
 * which this script used to do — leaves the counter stale, so the next append from
 * the API chains onto an older hash and the chain forks.
 *
 * `hashPlatformEntry` lives in the compiled output, so this needs a built API
 * (`npm -w @assetmon/api run build`) or the production image, which has one. That is
 * the same requirement the --reset-mfa path already carries. It throws rather than
 * degrading to an unhashed row: an audit entry nobody can verify is not worth writing.
 */
async function appendPlatformAudit(prisma, entry) {
  let hashPlatformEntry;
  try {
    ({ hashPlatformEntry } = require('../dist/platform/platform-audit-hash'));
  } catch (e) {
    throw new Error(
      'Cannot write a verifiable audit row: apps/api/dist is missing. ' +
      'Build first (npm -w @assetmon/api run build), or run this inside the API image.',
    );
  }
  return prisma.$transaction(
    (tx) => appendChainedEntryTx(tx, hashPlatformEntry, entry),
    { isolationLevel: 'ReadCommitted' },
  );
}

/**
 * The chained append itself, for callers that already hold a transaction (the
 * break-glass reset needs the audit row and the MFA clear to commit together).
 */
async function appendChainedEntryTx(tx, hashPlatformEntry, entry) {
  const rows = await tx.$queryRawUnsafe(
    `SELECT "lastSeq", "lastHash" FROM "PlatformAuditCounter" WHERE "id" = 'platform' FOR UPDATE`,
  );
  if (rows.length === 0) throw new Error('PlatformAuditCounter singleton is missing — seed it at deploy time.');
  const prevHash = rows[0].lastHash ?? null;
  const createdAt = new Date();
  const full = {
    actorId: entry.actorId,
    actorEmail: entry.actorEmail,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: entry.metadata ?? {},
    ipAddress: null,
    userAgent: null,
    createdAt,
  };
  const entryHash = hashPlatformEntry({ prevHash, ...full });
  const row = await tx.platformAuditLog.create({ data: { ...full, prevHash, entryHash } });
  await tx.platformAuditCounter.update({
    where: { id: 'platform' },
    data: { lastSeq: row.seq, lastHash: entryHash },
  });
  return row;
}

/**
 * Break-glass MFA reset (host/SSH only). Clears a locked-out operator's MFA so
 * they re-enroll at next login. Gated by a separate BREAKGLASS_TOKEN (DB access
 * alone is insufficient) and writes a hash-chained PlatformAuditLog row so the
 * reset is tamper-evident (R7/S7). Uses the SAME clearMfaUserData() column set
 * as the service-side clearMfa, so the two never drift.
 */
async function resetMfaFlow(args, email) {
  const expected = process.env.BREAKGLASS_TOKEN;
  const provided = typeof args['breakglass-token'] === 'string' ? args['breakglass-token'] : '';
  if (!expected) {
    console.error('Error: BREAKGLASS_TOKEN is not set in the environment. --reset-mfa is refused.');
    process.exit(2);
  }
  if (!provided || !timingSafeEq(provided, expected)) {
    console.error('Error: --breakglass-token is missing or does not match BREAKGLASS_TOKEN.');
    process.exit(2);
  }
  if (!process.env.CATALOG_DATABASE_URL) {
    console.error('Error: CATALOG_DATABASE_URL is not set. Did you create the .env file at the repo root?');
    process.exit(1);
  }
  if ((process.env.NODE_ENV || '').toLowerCase() === 'production' && !args['allow-prod']) {
    console.error('Refusing to reset MFA on a production catalog DB without --allow-prod.');
    process.exit(2);
  }

  // Shared, compiled helpers (require the build output; this path runs in the
  // production image or after `npm run db:setup && nest build`).
  const { clearMfaUserData } = require('../dist/platform/platform-mfa-clear');
  const { hashPlatformEntry } = require('../dist/platform/platform-audit-hash');

  const prisma = new PrismaClient({ adapter: makeAdapter(process.env.CATALOG_DATABASE_URL) });
  try {
    await prisma.$connect();
    const user = await prisma.platformUser.findUnique({ where: { email } });
    if (!user) {
      console.error('Error: no platform user with email ' + email);
      process.exit(1);
    }
    await prisma.$transaction(
      async (tx) => {
        await tx.platformBackupCode.deleteMany({ where: { userId: user.id } });
        await tx.platformMfaPending.deleteMany({ where: { userId: user.id } });
        const updated = await tx.platformUser.update({ where: { id: user.id }, data: clearMfaUserData() });
        if (updated.mfaEnrolledAt !== null) throw new Error('post-condition failed: mfaEnrolledAt is not null');

        // Chain against the PlatformAuditCounter, not a `findFirst orderBy seq desc`
        // tail scan. The API advances that counter on every append and reads its
        // lastHash to chain; appending here without moving it leaves the counter
        // stale, so the next API entry chains onto an older hash and the chain forks.
        await appendChainedEntryTx(tx, hashPlatformEntry, {
          actorId: 'cli-breakglass',
          actorEmail: 'cli-breakglass',
          action: 'platform.cli.mfa_reset',
          targetType: 'platformUser',
          targetId: user.id,
          metadata: { source: 'cli', host: require('os').hostname(), incidentRef: args['incident-ref'] || null },
        });
      },
      { isolationLevel: 'ReadCommitted' },
    );
    console.log('');
    console.log('✓ MFA reset for ' + email + '.');
    console.log('  They are now password-only and will be force-gated into MFA setup at next login.');
    console.log('');
    process.exit(0);
  } catch (e) {
    console.error('Reset failed:', (e && e.message) || e);
    process.exit(1);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage:');
    console.log('  Create/reset admin : npm run platform:bootstrap-admin -- --email me@example.com [--password ...] [--firstName ...] [--lastName ...]');
    console.log('  Break-glass MFA reset: npm run platform:bootstrap-admin -- --email me@example.com --reset-mfa --breakglass-token <BREAKGLASS_TOKEN> [--incident-ref REF] [--allow-prod]');
    process.exit(0);
  }
  const email = (args.email || '').toLowerCase().trim();
  if (!email || !/.+@.+\..+/.test(email)) {
    console.error('Error: --email is required (e.g. --email you@yourcompany.com)');
    process.exit(1);
  }

  // Break-glass: reset a locked-out operator's MFA (host/SSH only). Requires a
  // separate BREAKGLASS_TOKEN so DB connectivity alone is insufficient.
  if (args['reset-mfa']) {
    await resetMfaFlow(args, email);
    return;
  }

  const firstName = args.firstName || 'Platform';
  const lastName = args.lastName || 'Admin';
  let password = args.password;
  let generated = false;
  if (!password) {
    password = genPassword();
    generated = true;
  }
  // Enforce the same policy as the self-service change-password flow so the
  // operator cannot accidentally provision an account weaker than what the API
  // would later let the user set themselves.
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    console.error('Error: --password must be at least 10 characters and include a letter and a digit');
    process.exit(1);
  }
  if (!process.env.CATALOG_DATABASE_URL) {
    console.error('Error: CATALOG_DATABASE_URL is not set. Did you create the .env file at the repo root?');
    process.exit(1);
  }
  // Production guard rail. The catalog DB on a production host should not be
  // modified by a script run on a developer laptop or CI runner by accident.
  // Require an explicit acknowledgement when NODE_ENV=production.
  if ((process.env.NODE_ENV || '').toLowerCase() === 'production' && !args['allow-prod']) {
    console.error('Refusing to run against a production catalog DB without --allow-prod.');
    console.error('This script will create or reset a SUPER_ADMIN account; pass --allow-prod to confirm.');
    process.exit(2);
  }

  const prisma = new PrismaClient({ adapter: makeAdapter(process.env.CATALOG_DATABASE_URL) });
  try {
    await prisma.$connect();
    
    // Seed PlatformAuditCounter singleton if it doesn't exist
    await prisma.platformAuditCounter.upsert({
      where: { id: 'platform' },
      update: {},
      create: { id: 'platform', lastSeq: 0, lastHash: null }
    }).catch(() => {});

    const cost = Number(process.env.BCRYPT_COST || 12);
    const passwordHash = await bcrypt.hash(password, cost);

    const existing = await prisma.platformUser.findUnique({ where: { email } });
    let user;
    let action;
    if (existing) {
      user = await prisma.platformUser.update({
        where: { email },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          // Always upgrade to SUPER_ADMIN + active when invoked from the CLI:
          // operator already has shell access to the catalog DB, so anything
          // less is just a foot-gun.
          role: 'SUPER_ADMIN',
          active: true,
          firstName: args.firstName || existing.firstName,
          lastName: args.lastName || existing.lastName,
          failedLoginCount: 0,
          lockedUntil: null,
          tokenVersion: { increment: 1 },
        },
      });
      action = 'platform.cli.reset';
    } else {
      user = await prisma.platformUser.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          role: 'SUPER_ADMIN',
          active: true,
          passwordChangedAt: new Date(),
        },
      });
      action = 'platform.cli.bootstrap';
    }

    // Creating or resetting a SUPER_ADMIN is the most privileged thing this system
    // can do, so its audit row has to be tamper-evident like every other. This used
    // to write the row with no prevHash/entryHash at all — present in the log, but
    // silently alterable, and leaving a gap in the middle of the chain.
    //
    // Deliberately NOT best-effort any more: an unrecorded (or unverifiable)
    // super-admin creation is worse than a failed bootstrap, and the failure is
    // recoverable by re-running.
    await appendPlatformAudit(prisma, {
      actorId: user.id,
      actorEmail: user.email,
      action,
      targetType: 'platformUser',
      targetId: user.id,
      metadata: { source: 'cli', host: require('os').hostname() },
    });

    console.log('');
    console.log(existing ? '✓ Platform admin password reset.' : '✓ Platform super admin created.');
    console.log('  email   : ' + user.email);
    console.log('  role    : ' + user.role);
    if (generated) {
      console.log('  password: ' + password + '   (one-time generated — store this safely)');
    } else {
      console.log('  password: (the value you supplied via --password)');
    }
    console.log('');
    console.log('Sign in at http://localhost:3000/platform/login');
    console.log('');
    process.exit(0);
  } catch (e) {
    console.error('Failed:', e?.message || e);
    process.exit(1);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
})();
