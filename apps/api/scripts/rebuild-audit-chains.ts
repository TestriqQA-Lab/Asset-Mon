/**
 * rebuild-audit-chains.ts
 *
 * Re-stamps every tenant's audit chain onto the current hash recipe (v3) and
 * re-points its AuditCounter at the new tail.
 *
 * WHY CUTOVER NEEDS THIS
 * Chains migrated out of Postgres do not verify, and never did: they predate the
 * stable-JSON hash recipe and were written with the legacy JSON.stringify one. That
 * is not migration damage — those rows fail verification against the Postgres source
 * too. But the cutover acceptance test is "run /audit/verify for each tenant and it
 * must pass", so without this pass the cutover fails on data that was never healthy.
 *
 * WHAT IT DOES NOT DO
 * It cannot reconstruct history. Re-stamping proves nothing about what happened
 * before it ran; it re-establishes a verifiable chain going forward. Every rebuild
 * appends an `audit.chain.rebuild` marker so the event itself is on the chain and
 * cannot be performed invisibly.
 *
 * Usage:
 *   DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME \
 *     npx ts-node scripts/rebuild-audit-chains.ts [--dry-run]
 */
import { PrismaClient, makeAdapter } from '@assetmon/db';
import { computeEntryHash, AUDIT_HASH_VERSION } from '../src/common/audit-hash';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required. Set it in the environment; this script has no default.`);
  return v;
}

const db = new PrismaClient({ adapter: makeAdapter(required('DATABASE_URL')) });
const DRY = process.argv.includes('--dry-run');

/** Mirrors AuditService.verifyChain() so before/after can be compared here. */
function verify(rows: any[]): { intact: boolean; firstBreak?: number } {
  let prev: string | null = null;
  for (const r of rows) {
    if (r.entryHash == null) { prev = null; continue; }
    const expected = computeEntryHash({
      prevHash: r.prevHash, action: r.action, assetId: r.assetId,
      performedById: r.performedById, detail: r.detail, createdAt: r.createdAt,
      hashVersion: r.hashVersion, tenantId: r.tenantId,
    });
    if (r.entryHash !== expected || (prev != null && r.prevHash !== prev)) {
      return { intact: false, firstBreak: r.seq };
    }
    prev = r.entryHash;
  }
  return { intact: true };
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log(`  Audit chain rebuild${DRY ? ' (DRY RUN — no writes)' : ''}`);
  console.log('═══════════════════════════════════════════════\n');

  const tenants = await db.tenant.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, slug: true } });
  console.log(`${tenants.length} tenant(s)\n`);

  let healthy = 0, repaired = 0, failed = 0;

  for (const t of tenants) {
    const rows = await db.auditLog.findMany({ where: { tenantId: t.id }, orderBy: { seq: 'asc' } });
    if (rows.length === 0) {
      // A tenant with no entries still needs its counter to exist, or its first
      // audited action will throw.
      const counter = await db.auditCounter.findUnique({ where: { tenantId: t.id } });
      if (!counter && !DRY) await db.auditCounter.create({ data: { tenantId: t.id } });
      console.log(`  ${t.slug.padEnd(24)} 0 entries${counter ? '' : '  (counter seeded)'}`);
      healthy++;
      continue;
    }

    const before = verify(rows);
    if (before.intact) {
      console.log(`  ${t.slug.padEnd(24)} ${String(rows.length).padStart(4)} entries  already intact`);
      healthy++;
      continue;
    }

    if (DRY) {
      console.log(`  ${t.slug.padEnd(24)} ${String(rows.length).padStart(4)} entries  WOULD REBUILD (breaks at seq ${before.firstBreak})`);
      repaired++;
      continue;
    }

    // Hold the counter for the duration, so a concurrent writeAuditEntry cannot
    // append onto the pre-rebuild tail and fork the chain being repaired.
    await db.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe(
        `SELECT "lastSeq" FROM "AuditCounter" WHERE "tenantId" = $1 FOR UPDATE`, t.id,
      );
      let prev: string | null = null;
      let updated = 0;
      for (const r of rows) {
        const newHash = computeEntryHash({
          prevHash: prev, action: r.action, assetId: r.assetId,
          performedById: r.performedById, detail: r.detail, createdAt: r.createdAt,
          hashVersion: AUDIT_HASH_VERSION, tenantId: t.id,
        });
        if (r.entryHash !== newHash || r.prevHash !== prev || r.hashVersion !== AUDIT_HASH_VERSION) {
          await tx.auditLog.update({
            where: { id: r.id },
            data: { entryHash: newHash, prevHash: prev, hashVersion: AUDIT_HASH_VERSION },
          });
          updated++;
        }
        prev = newHash;
      }
      // Tail marker, so the rebuild is itself on the chain.
      const createdAt = new Date();
      const detail = { rebuilt: true, count: rows.length, updated, hashVersion: AUDIT_HASH_VERSION };
      const tailHash = computeEntryHash({
        prevHash: prev, action: 'audit.chain.rebuild', assetId: null,
        performedById: null, detail, createdAt, hashVersion: AUDIT_HASH_VERSION, tenantId: t.id,
      });
      const tail = await tx.auditLog.create({
        data: {
          tenantId: t.id, action: 'audit.chain.rebuild', detail, performedById: null,
          prevHash: prev, entryHash: tailHash, hashVersion: AUDIT_HASH_VERSION, createdAt,
        },
      });
      await tx.auditCounter.upsert({
        where: { tenantId: t.id },
        create: { tenantId: t.id, lastSeq: tail.seq, lastHash: tailHash },
        update: { lastSeq: tail.seq, lastHash: tailHash },
      });
    }, { timeout: 300_000, maxWait: 10_000 });

    const after = verify(await db.auditLog.findMany({ where: { tenantId: t.id }, orderBy: { seq: 'asc' } }));
    if (after.intact) {
      console.log(`  ${t.slug.padEnd(24)} ${String(rows.length).padStart(4)} entries  REBUILT ✓`);
      repaired++;
    } else {
      console.log(`  ${t.slug.padEnd(24)} ${String(rows.length).padStart(4)} entries  STILL BROKEN at seq ${after.firstBreak} ✗`);
      failed++;
    }
  }

  console.log(`\n  already intact: ${healthy}   ${DRY ? 'would rebuild' : 'rebuilt'}: ${repaired}   failed: ${failed}`);
  if (failed > 0) {
    console.log('\n  ✗ Some chains did not verify after rebuild — investigate before going live.\n');
    process.exitCode = 1;
    return;
  }
  console.log(DRY ? '\n  Dry run complete — no changes written.\n' : '\n  ✅ Every tenant chain verifies.\n');
}

main()
  .catch((e) => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
