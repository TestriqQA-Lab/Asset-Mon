/**
 * consolidate-data.ts
 *
 * Phase 3: Migrates data from Postgres (catalog + per-tenant DBs) → shared MySQL.
 *
 * Usage:
 *   POSTGRES_URL=postgresql://USER:PASSWORD@HOST:5432
 *   DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/DBNAME
 *   npx ts-node scripts/consolidate-data.ts
 */
import { Pool as PgPool } from 'pg';
import { PrismaClient, makeAdapter } from '@assetmon/db';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required. Set it in the environment; this script has no default.`);
  return v;
}

const POSTGRES_URL = required('POSTGRES_URL');

/**
 * `SET FOREIGN_KEY_CHECKS=0` is SESSION state, not server state — it applies to the
 * one connection that ran it. Prisma pools connections, so with the default pool the
 * setting lands on one connection while the inserts that depend on it run on others,
 * and the load fails on the first row whose parent has not been copied yet.
 *
 * Pinning the pool to a single connection makes the session settings and every statement
 * share one connection. This is a single-threaded batch script, so there is nothing to
 * gain from a larger pool anyway.
 *
 * The limit is set on the adapter rather than as `connection_limit` on the URL, because
 * that is a Prisma parameter and the mariadb driver ignores it without saying so — which
 * would leave this script silently running its session settings on the wrong connection.
 */
const mysql = new PrismaClient({
  adapter: makeAdapter(required('DATABASE_URL'), { connectionLimit: 1, minimumIdle: 1 }),
});

/** Models whose rows must be inserted in chain order — see the sort below. */
const HASH_CHAINED = new Set(['AuditLog', 'PlatformAuditLog']);

/** Rows dropped by a unique-constraint collision, collected and reported at the end. */
const shortfalls: Array<{ scope: string; model: string; expected: number; got: number }> = [];

// ── Tenant-scoped models in the old per-tenant Postgres DBs.
// These need tenantId injected during migration.
const TENANT_MODELS = [
  'User', 'Department', 'Location', 'Category', 'Vendor', 'Asset',
  'Assignment', 'MaintenanceSchedule', 'ServiceTicket',
  'PurchaseRequest', 'PurchaseRequestItem',
  'PurchaseOrder', 'PurchaseOrderItem',
  'Software', 'SoftwareLicense', 'SoftwareAssignment',
  'Reservation', 'AuditSession', 'AuditScan',
  'AssetAttachment', 'AssetStatusDef', 'SavedView',
  'ApiKey', 'Webhook', 'WebhookDelivery', 'EmailLog',
  'AuditLog', 'Notification', 'RefreshTokenJti',
  'IdempotencyKey', 'TenantMfaPending', 'TenantBackupCode',
  'AssetRequest', 'AssetRequestItem',
];

// ── Global catalog models (no tenantId injection needed, copy as-is).
const GLOBAL_MODELS = [
  'Tenant', 'TenantUser', 'PlatformUser',
  'PlatformAuditLog', 'PlatformRefreshTokenJti',
  'PlatformMfaPending', 'PlatformBackupCode',
  'PlatformOperatorEmailLog', 'PlatformMfaResetRequest',
  'SupportRequest', 'SupportMessage', 'Announcement',
];

// ── Columns to skip (auto-generated or relational by Prisma, not present in PG raw rows)
const SKIP_COLUMNS = new Set(['_prisma_migrations']);

// Map Prisma model name → MySQL table name (they match in our schema)
function modelToTable(model: string): string { return model; }

async function fetchAllRows(pgPool: PgPool, table: string): Promise<any[]> {
  try {
    const res = await pgPool.query(`SELECT * FROM "${table}" ORDER BY CTID`);
    return res.rows;
  } catch (e: any) {
    // Table might not exist in older tenant DBs
    if (e.code === '42P01') return []; // relation does not exist
    throw e;
  }
}

function cleanRow(row: any, model: string): any {
  const cleaned: any = {};
  for (const [key, value] of Object.entries(row)) {
    // Skip internal Postgres columns
    if (key.startsWith('_')) continue;
    
    // AuditLog.seq / PlatformAuditLog.seq: drop, let MySQL auto-increment
    if ((model === 'AuditLog' || model === 'PlatformAuditLog') && key === 'seq') continue;
    
    // Webhook.events: Postgres string[] → JSON array (already JSON in new schema)
    if (model === 'Webhook' && key === 'events') {
      cleaned[key] = JSON.stringify(value);
      continue;
    }

    // BigInt fields need special handling
    if (typeof value === 'bigint') {
      cleaned[key] = Number(value);
      continue;
    }
    
    cleaned[key] = value;
  }
  return cleaned;
}

async function insertBatch(model: string, rows: any[], batchSize = 500) {
  const prismaModel = (mysql as any)[model[0].toLowerCase() + model.slice(1)];
  if (!prismaModel) {
    console.error(`  ⚠ Model ${model} not found on Prisma client, skipping.`);
    return 0;
  }
  
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    try {
      const result = await prismaModel.createMany({ data: batch, skipDuplicates: true });
      inserted += result.count;
    } catch (e: any) {
      // If createMany fails, try one-by-one to identify the problem row
      console.error(`  ⚠ Batch insert failed for ${model}, falling back to row-by-row...`);
      for (const row of batch) {
        try {
          await prismaModel.create({ data: row });
          inserted++;
        } catch (e2: any) {
          console.error(`  ✗ Failed to insert ${model} row id=${row.id}: ${e2.message}`);
        }
      }
    }
  }
  return inserted;
}

async function run() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Phase 3: Data Consolidation (PG → MySQL)');
  console.log('═══════════════════════════════════════════════\n');

  const catalogPool = new PgPool({ connectionString: `${POSTGRES_URL}/assetmon_catalog` });

  // ── Step 0: Disable FK checks for the entire load ──
  // Rows are copied model by model, so a child is often inserted before its parent.
  // Safe here only because verify-integrity.ts re-validates every FK afterwards.
  console.log('Disabling MySQL FK checks (single pooled connection)...');
  await mysql.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
  const [fkState]: any[] = await mysql.$queryRawUnsafe('SELECT @@SESSION.foreign_key_checks AS v');
  if (Number(fkState?.v) !== 0) {
    throw new Error('FOREIGN_KEY_CHECKS did not stick — the pool is handing out more than one connection.');
  }

  // ── Step 1: Migrate global (catalog) models ──
  console.log('\n── Step 1: Global Models ──');
  for (const model of GLOBAL_MODELS) {
    const rows = await fetchAllRows(catalogPool, model);
    if (rows.length === 0) {
      console.log(`  ${model}: 0 rows (skip)`);
      continue;
    }
    // PlatformAuditLog is a hash chain and its `seq` is re-assigned by MySQL's
    // auto-increment on insert, so insertion order becomes chain order. Rows are read
    // in CTID (physical) order, which matches insertion order only until something
    // rewrites a page — after a VACUUM FULL or a dump/restore it does not. Sorting by
    // createdAt makes the new seq agree with the chain, and keeps the counter seeded
    // below (ORDER BY seq DESC LIMIT 1) pointing at the real tail.
    if (HASH_CHAINED.has(model)) {
      rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }
    const cleaned = rows.map(r => cleanRow(r, model));
    const count = await insertBatch(model, cleaned);
    if (count !== rows.length) shortfalls.push({ scope: 'global', model, expected: rows.length, got: count });
    console.log(`  ${model}: ${rows.length} PG → ${count} MySQL${count !== rows.length ? '  ⚠ SHORTFALL' : ''}`);
  }

  // ── Step 2: Seed PlatformAuditCounter ──
  console.log('\n── Step 2: Seed PlatformAuditCounter ──');
  const palLast: any[] = await mysql.$queryRawUnsafe(
    'SELECT seq, entryHash FROM PlatformAuditLog ORDER BY seq DESC LIMIT 1'
  );
  if (palLast.length > 0) {
    await mysql.$executeRawUnsafe(
      'INSERT INTO PlatformAuditCounter (id, lastSeq, lastHash) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE lastSeq=VALUES(lastSeq), lastHash=VALUES(lastHash)',
      'platform', palLast[0].seq, palLast[0].entryHash
    );
    console.log(`  PlatformAuditCounter seeded: lastSeq=${palLast[0].seq}`);
  } else {
    await mysql.$executeRawUnsafe(
      'INSERT INTO PlatformAuditCounter (id, lastSeq, lastHash) VALUES (?, ?, NULL) ON DUPLICATE KEY UPDATE lastSeq=0',
      'platform', 0
    );
    console.log('  PlatformAuditCounter seeded: lastSeq=0 (no logs)');
  }

  // ── Step 3: Iterate tenant DBs ──
  console.log('\n── Step 3: Tenant Data ──');
  const tenants = await catalogPool.query('SELECT id, slug, "dbName", status FROM "Tenant"');
  console.log(`  Found ${tenants.rows.length} tenants.\n`);

  for (const tenant of tenants.rows) {
    console.log(`\n╔═ Tenant: ${tenant.slug} (${tenant.id}) ═╗`);
    const tenantPool = new PgPool({ connectionString: `${POSTGRES_URL}/${tenant.dbName}` });

    let totalRows = 0;
    for (const model of TENANT_MODELS) {
      const rows = await fetchAllRows(tenantPool, model);
      if (rows.length === 0) continue;

      // Chain order must survive the seq re-assignment — see the note in Step 1.
      if (HASH_CHAINED.has(model)) {
        rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      }

      const cleaned = rows.map(r => {
        const c = cleanRow(r, model);
        c.tenantId = tenant.id;
        return c;
      });

      const count = await insertBatch(model, cleaned);
      if (count !== rows.length) shortfalls.push({ scope: tenant.slug, model, expected: rows.length, got: count });
      console.log(`  ${model}: ${rows.length} PG → ${count} MySQL${count !== rows.length ? '  ⚠ SHORTFALL' : ''}`);
      totalRows += count;
    }

    // ── Step 3b: Seed AuditCounter for this tenant ──
    const alLast: any[] = await mysql.$queryRawUnsafe(
      'SELECT seq, entryHash FROM AuditLog WHERE tenantId = ? ORDER BY seq DESC LIMIT 1',
      tenant.id
    );
    if (alLast.length > 0) {
      await mysql.$executeRawUnsafe(
        'INSERT INTO AuditCounter (tenantId, lastSeq, lastHash) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE lastSeq=VALUES(lastSeq), lastHash=VALUES(lastHash)',
        tenant.id, alLast[0].seq, alLast[0].entryHash
      );
      console.log(`  AuditCounter seeded: lastSeq=${alLast[0].seq}`);
    } else {
      await mysql.$executeRawUnsafe(
        'INSERT INTO AuditCounter (tenantId, lastSeq, lastHash) VALUES (?, ?, NULL) ON DUPLICATE KEY UPDATE lastSeq=0',
        tenant.id, 0
      );
      console.log('  AuditCounter seeded: lastSeq=0 (no audit logs)');
    }

    console.log(`  Total: ${totalRows} rows migrated.`);
    await tenantPool.end();
  }

  // ── Step 4: Re-enable FK checks ──
  console.log('\n── Step 4: Re-enable FK checks ──');
  await mysql.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
  console.log('  FK checks re-enabled.');

  await catalogPool.end();
  await mysql.$disconnect();

  // ── Step 5: Report any rows the target refused ──
  // `createMany({ skipDuplicates: true })` is what makes this script re-runnable, but
  // it also means a row rejected by a unique constraint vanishes without an error.
  // The likely cause is collation: Postgres compared these columns case- and
  // accent-sensitively, MySQL's utf8mb4_general_ci does neither, so values that were
  // distinct in the source collide in the target — two assets tagged `AM-001` and
  // `am-001`, say. Loud and non-zero, because silently migrating fewer rows than the
  // source held is the worst outcome available.
  if (shortfalls.length > 0) {
    console.log('\n═══════════════════════════════════════════════');
    console.log('  ⚠  ROWS DROPPED — DO NOT PROCEED TO CUTOVER');
    console.log('═══════════════════════════════════════════════');
    let lost = 0;
    for (const s of shortfalls) {
      lost += s.expected - s.got;
      console.log(`  ${s.scope} / ${s.model}: ${s.expected} → ${s.got}  (lost ${s.expected - s.got})`);
    }
    console.log(`\n  ${lost} row(s) lost across ${shortfalls.length} model(s).`);
    console.log('  Find the collisions before re-running, e.g. for asset tags:');
    console.log("    SELECT lower(\"assetTag\"), count(*) FROM \"Asset\"");
    console.log('     GROUP BY 1 HAVING count(*) > 1;');
    console.log('  Resolve them in the SOURCE database, then re-run this script.\n');
    process.exitCode = 1;
    return;
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  ✅ Consolidation Complete — no rows dropped');
  console.log('═══════════════════════════════════════════════\n');
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
