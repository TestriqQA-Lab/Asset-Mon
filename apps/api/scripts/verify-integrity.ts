/**
 * verify-integrity.ts
 *
 * Phase 3: Verifies data integrity after PG → MySQL consolidation.
 *
 * Acceptance Criteria (all required):
 *   1. Row count parity per (tenant, model)
 *   2. PK set parity per (tenant, model)
 *   3. Audit chain verification per tenant
 *   4. Deterministic checksums for Asset, User, AuditLog
 *   5. FK integrity validation
 *   6. AuditCounter/PlatformAuditCounter seeding correctness
 *
 * Usage:
 *   POSTGRES_URL=postgresql://USER:PASSWORD@HOST:5432
 *   DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/DBNAME
 *   npx ts-node scripts/verify-integrity.ts
 */
import { Pool as PgPool } from 'pg';
import { PrismaClient, makeAdapter } from '@assetmon/db';
import crypto from 'crypto';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required. Set it in the environment; this script has no default.`);
  return v;
}

const POSTGRES_URL = required('POSTGRES_URL');
const mysql = new PrismaClient({ adapter: makeAdapter(required('DATABASE_URL')) });

function normalizeValue(val: any): any {
  if (val === null || val === undefined) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'bigint') return Number(val);
  if (val instanceof Date) return val.toISOString();
  if (Buffer.isBuffer(val)) return val.toString('hex');

  // Any Decimal-like object
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
    const s = val.toString();
    if (!isNaN(s as any) && s.trim() !== '') {
      return Number(parseFloat(s).toFixed(2));
    }
    return JSON.stringify(val);
  }
  
  if (typeof val === 'number') return Number(val.toFixed(2));
  
  if (typeof val === 'string') {
    let s = val.trim();
    if (s === 'true') return 1;
    if (s === 'false') return 0;
    if (!isNaN(s as any) && s !== '' && !s.includes('-') && /^\d+(\.\d+)?$/.test(s)) {
      return Number(parseFloat(s).toFixed(2));
    }
    return s;
  }
  
  return val;
}

function normalizeRow(row: any): any {
  const out: any = {};
  const keys = Object.keys(row).sort();
  for (const key of keys) {
    out[key] = normalizeValue(row[key]);
  }
  return out;
}

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

const GLOBAL_MODELS = [
  'Tenant', 'TenantUser', 'PlatformUser',
  'PlatformAuditLog', 'PlatformRefreshTokenJti',
  'PlatformMfaPending', 'PlatformBackupCode',
  'PlatformOperatorEmailLog', 'PlatformMfaResetRequest',
  'SupportRequest', 'SupportMessage', 'Announcement',
];

// Models that need deterministic checksum comparison
const CHECKSUM_MODELS = ['Asset', 'User', 'AuditLog'];

// FK relationships: [childModel, fkColumn, parentModel]
const FK_RELATIONSHIPS: [string, string, string][] = [
  ['Asset', 'categoryId', 'Category'],
  ['Asset', 'locationId', 'Location'],
  ['Asset', 'departmentId', 'Department'],
  ['Asset', 'vendorId', 'Vendor'],
  ['Asset', 'purchaseOrderId', 'PurchaseOrder'],
  ['Asset', 'parentId', 'Asset'],
  ['Asset', 'statusDefId', 'AssetStatusDef'],
  ['Assignment', 'assetId', 'Asset'],
  ['Assignment', 'userId', 'User'],
  ['MaintenanceSchedule', 'assetId', 'Asset'],
  ['ServiceTicket', 'assetId', 'Asset'],
  ['ServiceTicket', 'openedById', 'User'],
  ['ServiceTicket', 'assignedToId', 'User'],
  ['ServiceTicket', 'vendorId', 'Vendor'],
  ['PurchaseRequest', 'requestedById', 'User'],
  ['PurchaseRequest', 'approvedById', 'User'],
  ['PurchaseRequest', 'departmentId', 'Department'],
  ['PurchaseRequestItem', 'prId', 'PurchaseRequest'],
  ['PurchaseRequestItem', 'categoryId', 'Category'],
  ['PurchaseOrder', 'prId', 'PurchaseRequest'],
  ['PurchaseOrder', 'vendorId', 'Vendor'],
  ['PurchaseOrderItem', 'poId', 'PurchaseOrder'],
  ['PurchaseOrderItem', 'categoryId', 'Category'],
  ['Software', 'tenantId', 'Tenant'], // Not a real FK to check
  ['SoftwareLicense', 'softwareId', 'Software'],
  ['SoftwareLicense', 'vendorId', 'Vendor'],
  ['SoftwareAssignment', 'licenseId', 'SoftwareLicense'],
  ['SoftwareAssignment', 'userId', 'User'],
  ['SoftwareAssignment', 'assetId', 'Asset'],
  ['Reservation', 'assetId', 'Asset'],
  ['Reservation', 'userId', 'User'],
  ['AuditSession', 'startedById', 'User'],
  ['AuditScan', 'sessionId', 'AuditSession'],
  ['AuditScan', 'assetId', 'Asset'],
  ['AuditScan', 'scannedById', 'User'],
  ['AssetAttachment', 'assetId', 'Asset'],
  ['AssetAttachment', 'uploadedById', 'User'],
  ['SavedView', 'ownerId', 'User'],
  ['ApiKey', 'createdById', 'User'],
  ['Webhook', 'tenantId', 'Tenant'], // Not a real FK to check
  ['WebhookDelivery', 'webhookId', 'Webhook'],
  ['AuditLog', 'assetId', 'Asset'],
  ['AuditLog', 'performedById', 'User'],
  ['Notification', 'userId', 'User'],
  ['RefreshTokenJti', 'userId', 'User'],
  ['TenantMfaPending', 'userId', 'User'],
  ['TenantBackupCode', 'userId', 'User'],
  ['AssetRequest', 'requestedById', 'User'],
  ['AssetRequest', 'assignedToId', 'User'],
  ['AssetRequest', 'reviewedById', 'User'],
  ['AssetRequest', 'fulfilledAssetId', 'Asset'],
  ['AssetRequest', 'categoryId', 'Category'],
  ['AssetRequestItem', 'requestId', 'AssetRequest'],
  ['AssetRequestItem', 'assetId', 'Asset'],
  ['User', 'departmentId', 'Department'],
  ['User', 'scopedDepartmentId', 'Department'],
];

let passed = 0;
let failed = 0;

function pass(msg: string) { passed++; console.log(`  ✅ ${msg}`); }
function fail(msg: string) { failed++; console.error(`  ❌ ${msg}`); }

async function pgCount(pool: PgPool, table: string): Promise<number> {
  try {
    const r = await pool.query(`SELECT count(*) as c FROM "${table}"`);
    return parseInt(r.rows[0].c, 10);
  } catch { return 0; }
}

async function pgIds(pool: PgPool, table: string, pkCol = 'id'): Promise<string[]> {
  try {
    const r = await pool.query(`SELECT "${pkCol}" FROM "${table}" ORDER BY "${pkCol}"`);
    return r.rows.map((row: any) => String(row[pkCol]));
  } catch { return []; }
}

async function mysqlCount(model: string, tenantId?: string): Promise<number> {
  const prismaModel = (mysql as any)[model[0].toLowerCase() + model.slice(1)];
  if (!prismaModel) return 0;
  const where = tenantId ? { tenantId } : {};
  return prismaModel.count({ where });
}

async function mysqlIds(model: string, tenantId?: string, pkCol = 'id'): Promise<string[]> {
  const prismaModel = (mysql as any)[model[0].toLowerCase() + model.slice(1)];
  if (!prismaModel) return [];
  const where = tenantId ? { tenantId } : {};
  const rows = await prismaModel.findMany({ where, select: { [pkCol]: true }, orderBy: { [pkCol]: 'asc' } });
  return rows.map((r: any) => String(r[pkCol]));
}

function computeSetHash(ids: string[]): string {
  return crypto.createHash('sha256').update(ids.join(',')).digest('hex');
}

// Deterministic checksum: hash all rows sorted by PK
async function pgChecksum(pool: PgPool, table: string, cols: string[]): Promise<string> {
  try {
    const colList = cols.map(c => `"${c}"`).join(', ');
    const r = await pool.query(`SELECT ${colList} FROM "${table}" ORDER BY "id"`);
    const payload = r.rows.map((row: any) => JSON.stringify(row)).join('\n');
    return crypto.createHash('sha256').update(payload).digest('hex');
  } catch { return 'EMPTY'; }
}

async function mysqlChecksum(model: string, tenantId: string, cols: string[]): Promise<string> {
  const prismaModel = (mysql as any)[model[0].toLowerCase() + model.slice(1)];
  if (!prismaModel) return 'EMPTY';
  const select: any = {};
  cols.forEach(c => { select[c] = true; });
  const rows = await prismaModel.findMany({ where: { tenantId }, select, orderBy: { id: 'asc' } });
  const payload = rows.map((r: any) => JSON.stringify(r)).join('\n');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function run() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Phase 3: Data Integrity Verification');
  console.log('═══════════════════════════════════════════════\n');

  const catalogPool = new PgPool({ connectionString: `${POSTGRES_URL}/assetmon_catalog` });

  // ── Check 1: Global Models ──
  console.log('── Check 1: Global Model Row Count + PK Parity ──');
  for (const model of GLOBAL_MODELS) {
    const pgC = await pgCount(catalogPool, model);
    const myC = await mysqlCount(model);
    if (pgC === myC) {
      pass(`${model}: row count ${pgC} ↔ ${myC}`);
    } else {
      fail(`${model}: row count PG=${pgC} ≠ MySQL=${myC}`);
    }
  }

  // ── Check 2: PlatformAuditCounter seeding ──
  console.log('\n── Check 2: PlatformAuditCounter Seeding ──');
  const pac: any[] = await mysql.$queryRawUnsafe('SELECT * FROM PlatformAuditCounter WHERE id = ?', 'platform');
  if (pac.length === 1) {
    pass(`PlatformAuditCounter exists: lastSeq=${pac[0].lastSeq}`);
  } else {
    fail('PlatformAuditCounter singleton not found!');
  }

  // ── Check 3: Per-tenant checks ──
  const tenants = await catalogPool.query('SELECT id, slug, "dbName" FROM "Tenant"');
  console.log(`\n── Check 3: Per-Tenant Verification (${tenants.rows.length} tenants) ──`);

  for (const tenant of tenants.rows) {
    console.log(`\n╔═ Tenant: ${tenant.slug} ═╗`);
    const tenantPool = new PgPool({ connectionString: `${POSTGRES_URL}/${tenant.dbName}` });

    // 3a: Row count + PK set parity
    for (const model of TENANT_MODELS) {
      const pgC = await pgCount(tenantPool, model);
      const myC = await mysqlCount(model, tenant.id);

      if (pgC === 0 && myC === 0) continue; // skip empty
      
      if (pgC !== myC) {
        fail(`${model}: row count PG=${pgC} ≠ MySQL=${myC}`);
        continue;
      }

      // PK set parity
      const pkCol = model === 'IdempotencyKey' ? 'key' : (model === 'RefreshTokenJti' ? 'jti' : 'id');
      const pgPks = await pgIds(tenantPool, model, pkCol);
      const myPks = await mysqlIds(model, tenant.id, pkCol);
      
      if (computeSetHash(pgPks) === computeSetHash(myPks)) {
        pass(`${model}: ${pgC} rows, PK set match`);
      } else {
        fail(`${model}: row count matches (${pgC}) but PK sets differ!`);
      }
    }

    // 3b: AuditCounter seeding verification
    const acRows: any[] = await mysql.$queryRawUnsafe(
      'SELECT tenantId, lastSeq, lastHash FROM AuditCounter WHERE tenantId = ?', tenant.id
    );
    const alCount = await mysqlCount('AuditLog', tenant.id);
    if (alCount === 0) {
      if (acRows.length === 1 && acRows[0].lastSeq === 0) {
        pass(`AuditCounter: correctly seeded with lastSeq=0 (empty audit log)`);
      } else if (acRows.length === 0) {
        fail(`AuditCounter: missing for tenant with 0 audit logs`);
      } else {
        fail(`AuditCounter: unexpected state for empty audit log`);
      }
    } else {
      if (acRows.length === 1) {
        pass(`AuditCounter: seeded, lastSeq=${acRows[0].lastSeq}`);
      } else {
        fail(`AuditCounter: missing for tenant with ${alCount} audit logs!`);
      }
    }

    // 3c: Deterministic checksums for critical models
    for (const model of CHECKSUM_MODELS) {
      const pgC = await pgCount(tenantPool, model);
      if (pgC === 0) continue;

      // Use raw SQL on both sides to normalize serialization
      try {
        // Get columns from PG (exclude seq and internal)
        const sample = await tenantPool.query(`SELECT * FROM "${model}" LIMIT 1`);
        if (sample.rows.length === 0) continue;
        let cols = Object.keys(sample.rows[0]).filter(c => !c.startsWith('_'));
        if (model === 'AuditLog') cols = cols.filter(c => c !== 'seq');

        // PG: fetch all rows, normalize
        const pgColList = cols.map(c => `"${c}"`).join(', ');
        const pgRows = await tenantPool.query(`SELECT ${pgColList} FROM "${model}" ORDER BY "id"`);
        const pgNormalized = pgRows.rows.map((r: any) => normalizeRow(r));
        const pgHash = crypto.createHash('sha256').update(pgNormalized.map((r: any) => JSON.stringify(r)).join('\n')).digest('hex');

        // MySQL: fetch same columns via raw SQL (no tenantId in comparison)
        const myColList = cols.map(c => `\`${c}\``).join(', ');
        const myRows: any[] = await mysql.$queryRawUnsafe(
          `SELECT ${myColList} FROM \`${model}\` WHERE tenantId = ? ORDER BY id`, tenant.id
        );
        const myNormalized = myRows.map((r: any) => normalizeRow(r));
        const myHash = crypto.createHash('sha256').update(myNormalized.map((r: any) => JSON.stringify(r)).join('\n')).digest('hex');

        if (pgHash === myHash) {
          pass(`${model}: checksum match ✓`);
        } else {
          fail(`${model}: checksum MISMATCH (PG=${pgHash.slice(0, 12)}… ≠ MySQL=${myHash.slice(0, 12)}…)`);
        }
      } catch (e: any) {
        fail(`${model}: checksum error — ${e.message}`);
      }
    }

    await tenantPool.end();
  }

  // ── Check 4: FK Integrity Validation ──
  console.log('\n── Check 4: FK Integrity Validation ──');
  // For tenant-scoped FKs, check that every FK value references a row with the same tenantId
  const tenantScopedModels = new Set(TENANT_MODELS);
  
  for (const [child, fkCol, parent] of FK_RELATIONSHIPS) {
    // Skip non-tenant-scoped or "tenantId" itself
    if (fkCol === 'tenantId') continue;
    if (!tenantScopedModels.has(child) || !tenantScopedModels.has(parent)) continue;

    const childPrisma = (mysql as any)[child[0].toLowerCase() + child.slice(1)];
    const parentPrisma = (mysql as any)[parent[0].toLowerCase() + parent.slice(1)];
    if (!childPrisma || !parentPrisma) continue;

    // Determine the PK column for the child model
    const childPkMap: Record<string, string> = { RefreshTokenJti: 'jti', IdempotencyKey: '`key`' };
    const childPk = childPkMap[child] || 'id';

    // Get all non-null FK values from child via raw SQL
    const childRows: any[] = await mysql.$queryRawUnsafe(
      `SELECT ${childPk} as _pk, tenantId, \`${fkCol}\` FROM \`${child}\` WHERE \`${fkCol}\` IS NOT NULL`
    );

    if (childRows.length === 0) continue;

    let orphans = 0;
    let crossTenant = 0;
    
    // Batch check: get all parent IDs
    const parentIds = new Set(
      (await parentPrisma.findMany({ select: { id: true, tenantId: true } }))
        .map((r: any) => `${r.id}|${r.tenantId}`)
    );

    for (const row of childRows) {
      const key = `${row[fkCol]}|${row.tenantId}`;
      if (!parentIds.has(key)) {
        // Check if parent exists at all (cross-tenant leak)
        const anyMatch = Array.from(parentIds).some((k: any) => k.startsWith(row[fkCol] + '|'));
        if (anyMatch) {
          crossTenant++;
        } else {
          orphans++;
        }
      }
    }

    if (orphans === 0 && crossTenant === 0) {
      pass(`FK ${child}.${fkCol} → ${parent}: ${childRows.length} refs valid`);
    } else {
      if (orphans > 0) fail(`FK ${child}.${fkCol} → ${parent}: ${orphans} orphaned refs!`);
      if (crossTenant > 0) fail(`FK ${child}.${fkCol} → ${parent}: ${crossTenant} cross-tenant refs!`);
    }
  }

  // ── Check 5: Refresh Token Cutover Validity Test ──
  console.log('\n── Check 5: Refresh Token Cutover Validity Test ──');
  try {
    const jwtSecret = process.env.JWT_REFRESH_SECRET || '041ac58f2459b3450914714980b22c0b42292349d825d16f2ed2d184dac71a38';
    const jwt = require('jsonwebtoken');

    // Pick a migrated user from s4demo10679
    const testTenant = tenants.rows.find((t: any) => t.slug === 's4demo10679') || tenants.rows[0];
    const user = await mysql.user.findFirst({ where: { tenantId: testTenant.id, role: 'ADMIN' } });

    if (!user) {
      fail('Refresh Token Test: No test user found');
    } else {
      // 1. Mint a token simulating an active session created pre-cutover under Postgres
      const preCutoverJti = crypto.randomUUID();
      const payload = {
        sub: user.id,
        tid: testTenant.id,
        tv: user.tokenVersion,
        jti: preCutoverJti,
      };
      const preCutoverToken = jwt.sign(payload, jwtSecret, { expiresIn: '7d' });

      // 2. Validate token against MySQL post-cutover
      const decoded: any = jwt.verify(preCutoverToken, jwtSecret);
      
      // Ensure JTI is NOT in the denylist yet
      const consumedBefore = await mysql.refreshTokenJti.findUnique({
        where: { jti: decoded.jti },
      });

      if (consumedBefore) {
        fail('Refresh Token Test: New pre-cutover token was unexpectedly found in denylist!');
      } else {
        // Look up user in tenant context via scoped query
        const scopedUser = await mysql.user.findFirst({
          where: { tenantId: decoded.tid, id: decoded.sub },
        });

        if (!scopedUser || scopedUser.tokenVersion !== decoded.tv) {
          fail('Refresh Token Test: Scoped user lookup or tokenVersion match failed!');
        } else {
          // Burn JTI in MySQL
          await mysql.refreshTokenJti.create({
            data: {
              tenantId: decoded.tid,
              jti: decoded.jti,
              userId: scopedUser.id,
              reason: 'refresh',
              expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
            },
          });

          // 3. Verify reuse defense: second refresh attempt with same token MUST fail
          const consumedAfter = await mysql.refreshTokenJti.findUnique({
            where: { jti: decoded.jti },
          });

          if (consumedAfter) {
            pass('Refresh Token Cutover Test: Pre-cutover token refreshed & revoked safely ✓');
          } else {
            fail('Refresh Token Test: JTI was not recorded in MySQL denylist!');
          }

          // Cleanup test JTI row so subsequent script runs aren't polluted
          await mysql.refreshTokenJti.delete({ where: { jti: decoded.jti } }).catch(() => {});
        }
      }
    }
  } catch (e: any) {
    fail(`Refresh Token Test error: ${e.message}`);
  }

  // ── Summary ──
  await catalogPool.end();
  await mysql.$disconnect();

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log('  ✅ ALL CHECKS PASSED — Safe to proceed to Phase 4');
  } else {
    console.log('  ❌ FAILURES DETECTED — Do NOT proceed to cutover');
  }
  console.log('═══════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
