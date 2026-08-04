import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required. Set it in the environment; this script has no default.`);
  return v;
}

const POSTGRES_URL = required('POSTGRES_URL');

async function run() {
  console.log('--- Seeding Test Data into Postgres ---');
  
  const catalogPool = new Pool({ connectionString: `${POSTGRES_URL}/assetmon_catalog?schema=public` });

  const tenants = [
    { slug: 'seed1_empty', name: 'Empty Tenant', type: 'empty' },
    { slug: 'seed2_medium', name: 'Medium Tenant', type: 'medium' },
    { slug: 'seed3_fk_pr', name: 'FK PR Tenant', type: 'fk' },
    { slug: 'seed4_audit', name: 'Audit Tenant', type: 'audit' },
  ];

  for (const t of tenants) {
    const tenantId = uuidv4();
    const dbName = `assetmon_t_${t.slug}`;
    
    console.log(`\nProvisioning Tenant: ${t.name} (${t.slug})`);
    
    // 1. Create in Catalog
    await catalogPool.query(`
      INSERT INTO "Tenant" (id, slug, name, "dbName", status, plan, "inviteDisabled", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, 'ACTIVE', 'starter', false, NOW(), NOW())
      ON CONFLICT (slug) DO NOTHING
    `, [tenantId, t.slug, t.name, dbName]);

    const res = await catalogPool.query(`SELECT id FROM "Tenant" WHERE slug = $1`, [t.slug]);
    const actualTenantId = res.rows[0].id;

    // Create DB if it doesn't exist (must connect to default db first)
    const defaultPool = new Pool({ connectionString: `${POSTGRES_URL}/postgres` });
    try {
      await defaultPool.query(`CREATE DATABASE ${dbName}`);
      console.log(`Created database ${dbName}`);
    } catch (e: any) {
      if (e.code !== '42P04') { // 42P04 = duplicate_database
        console.error(`Failed to create db ${dbName}`, e);
      }
    }
    await defaultPool.end();

    // 2. Initialize schema (very basic for testing)
    const tenantPool = new Pool({ connectionString: `${POSTGRES_URL}/${dbName}?schema=public` });
    
    await tenantPool.query(`
      CREATE TABLE IF NOT EXISTS "User" (
        id VARCHAR(191) PRIMARY KEY,
        email VARCHAR(191) UNIQUE NOT NULL,
        "firstName" VARCHAR(191) NOT NULL,
        "lastName" VARCHAR(191) NOT NULL,
        role VARCHAR(191) NOT NULL,
        "passwordHash" VARCHAR(191) NOT NULL,
        active BOOLEAN DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS "Category" (
        id VARCHAR(191) PRIMARY KEY,
        name VARCHAR(191) UNIQUE NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS "Asset" (
        id VARCHAR(191) PRIMARY KEY,
        "assetTag" VARCHAR(191) UNIQUE NOT NULL,
        "categoryId" VARCHAR(191) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Asset_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"(id)
      );
      CREATE TABLE IF NOT EXISTS "PurchaseRequest" (
        id VARCHAR(191) PRIMARY KEY,
        number VARCHAR(191) UNIQUE NOT NULL,
        title VARCHAR(191) NOT NULL,
        status VARCHAR(191) NOT NULL,
        "requestedById" VARCHAR(191) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PurchaseRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"(id)
      );
      CREATE TABLE IF NOT EXISTS "PurchaseRequestItem" (
        id VARCHAR(191) PRIMARY KEY,
        "prId" VARCHAR(191) NOT NULL,
        description VARCHAR(191) NOT NULL,
        quantity INTEGER NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PurchaseRequestItem_prId_fkey" FOREIGN KEY ("prId") REFERENCES "PurchaseRequest"(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS "AuditLog" (
        id VARCHAR(191) PRIMARY KEY,
        seq SERIAL NOT NULL,
        "prevHash" VARCHAR(191),
        "entryHash" VARCHAR(191) NOT NULL,
        action VARCHAR(191) NOT NULL,
        "performedById" VARCHAR(191),
        detail JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "hashVersion" INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS "RefreshTokenJti" (
        jti VARCHAR(191) PRIMARY KEY,
        "userId" VARCHAR(191) NOT NULL,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "RefreshTokenJti_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE
      );
    `);

    // Insert Base User
    const userId = uuidv4();
    await tenantPool.query(`
      INSERT INTO "User" (id, email, "firstName", "lastName", role, "passwordHash")
      VALUES ($1, $2, 'Test', 'User', 'ADMIN', 'hash')
      ON CONFLICT (email) DO NOTHING
    `, [userId, `admin@${t.slug}.test`]);

    // Insert valid RefreshTokenJti
    await tenantPool.query(`
      INSERT INTO "RefreshTokenJti" (jti, "userId", "expiresAt")
      VALUES ($1, $2, NOW() + INTERVAL '30 days')
      ON CONFLICT (jti) DO NOTHING
    `, [uuidv4(), userId]);

    if (t.type === 'medium') {
      console.log('Seeding hundreds of assets...');
      const catId = uuidv4();
      await tenantPool.query(`INSERT INTO "Category" (id, name) VALUES ($1, 'Laptop') ON CONFLICT (name) DO NOTHING`, [catId]);
      
      let q = `INSERT INTO "Asset" (id, "assetTag", "categoryId") VALUES `;
      let values: any[] = [];
      let c = 1;
      for (let i=0; i<150; i++) {
        q += `($${c++}, $${c++}, $${c++})${i === 149 ? '' : ','}`;
        values.push(uuidv4(), `TAG-${t.slug}-${i}`, catId);
      }
      q += ` ON CONFLICT ("assetTag") DO NOTHING`;
      await tenantPool.query(q, values);
    } 
    
    if (t.type === 'fk') {
      console.log('Seeding PR with items for FK validation...');
      const prId = uuidv4();
      await tenantPool.query(`
        INSERT INTO "PurchaseRequest" (id, number, title, status, "requestedById")
        VALUES ($1, 'PR-001', 'Test PR', 'DRAFT', $2)
        ON CONFLICT (number) DO NOTHING
      `, [prId, userId]);

      await tenantPool.query(`
        INSERT INTO "PurchaseRequestItem" (id, "prId", description, quantity)
        VALUES ($1, $2, 'Item 1', 5), ($3, $4, 'Item 2', 10)
      `, [uuidv4(), prId, uuidv4(), prId]);
    }

    if (t.type === 'audit') {
      console.log('Seeding 10+ Audit Logs...');
      let prevHash: string | null = null;
      for (let i=0; i<12; i++) {
        const id = uuidv4();
        // Mimic hash chaining
        const payload = JSON.stringify({ action: `TEST_ACTION_${i}`, prev: prevHash || '' });
        const entryHash = crypto.createHash('sha256').update(payload).digest('hex');
        
        await tenantPool.query(`
          INSERT INTO "AuditLog" (id, "prevHash", "entryHash", action, "performedById", "hashVersion")
          VALUES ($1, $2, $3, $4, $5, 2)
        `, [id, prevHash, entryHash, `TEST_ACTION_${i}`, userId]);

        prevHash = entryHash;
      }
    }

    if (t.type === 'empty') {
      console.log('Leaving tenant empty (0 audit logs).');
    }

    await tenantPool.end();
  }
  
  await catalogPool.end();
  console.log('✅ Postgres Seed Complete');
}

run().catch(console.error);
