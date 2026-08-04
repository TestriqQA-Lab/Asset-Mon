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
import { PrismaClient } from '@assetmon/db';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required. Set it in the environment; this script has no default.`);
  return v;
}

const POSTGRES_URL = required('POSTGRES_URL');
const mysql = new PrismaClient({ datasources: { db: { url: required('DATABASE_URL') } } });

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
  console.log('Disabling MySQL FK checks...');
  await mysql.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');

  // ── Step 1: Migrate global (catalog) models ──
  console.log('\n── Step 1: Global Models ──');
  for (const model of GLOBAL_MODELS) {
    const rows = await fetchAllRows(catalogPool, model);
    if (rows.length === 0) {
      console.log(`  ${model}: 0 rows (skip)`);
      continue;
    }
    const cleaned = rows.map(r => cleanRow(r, model));
    const count = await insertBatch(model, cleaned);
    console.log(`  ${model}: ${rows.length} PG → ${count} MySQL`);
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

      // Sort AuditLog by createdAt to preserve ordering for new seq assignment
      if (model === 'AuditLog') {
        rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      }

      const cleaned = rows.map(r => {
        const c = cleanRow(r, model);
        c.tenantId = tenant.id;
        return c;
      });

      const count = await insertBatch(model, cleaned);
      console.log(`  ${model}: ${rows.length} PG → ${count} MySQL`);
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

  console.log('\n═══════════════════════════════════════════════');
  console.log('  ✅ Consolidation Complete');
  console.log('═══════════════════════════════════════════════\n');
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
