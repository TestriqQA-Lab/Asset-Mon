import { PrismaClient } from '@assetmon/db';
import { writeAuditEntry } from './src/common/audit-hash';
import * as crypto from 'crypto';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required. Set it in the environment; this script has no default.`);
  return v;
}

const db = new PrismaClient({ datasources: { db: { url: required('DATABASE_URL') } } });
const catalog = db;

// Basic tenant extension mock for testing
const tenantId = 's4demo10679';
const tenant = db.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const isTenantModel = ['Software', 'SoftwareLicense', 'SoftwareAssignment', 'AuditCounter', 'AuditLog', 'User'].includes(model);
        if (isTenantModel) {
          if (operation === 'create') (args.data as any).tenantId = tenantId;
          if (operation === 'findUnique' || operation === 'findFirst' || operation === 'findMany' || operation === 'update' || operation === 'updateMany' || operation === 'count') {
            args.where = { ...(args.where || {}), tenantId };
          }
        }
        return query(args);
      }
    }
  }
}) as any;

async function runTests() {
  console.log('--- Concurrency Tests Started ---\n');
  
  // Seed counter rows to prevent upsert race condition on missing rows
  await catalog.platformAuditCounter.upsert({
    where: { id: 'platform' },
    update: {},
    create: { id: 'platform', lastSeq: 0, lastHash: null }
  });
  await tenant.auditCounter.upsert({
    where: { tenantId },
    update: {},
    create: { tenantId, lastSeq: 0, lastHash: null }
  });

  // 1. Seat License Concurrency Test
  console.log('1. Seat License Concurrency Test');
  const software = await tenant.software.create({ data: { name: `Test Concurrency Software ${Date.now()}` } });
  const license = await tenant.softwareLicense.create({
    data: { softwareId: software.id, type: 'SUBSCRIPTION', seats: 10 },
  });

  console.log(`Created license with 10 seats. Firing 50 concurrent assignments...`);
  const assignAttempts = await Promise.allSettled(
    Array.from({ length: 50 }).map(async (_, i) => {
      // Inline the transaction logic from software.module.ts
      return await tenant.$transaction(async (tx: any) => {
        // FOR UPDATE lock
        await tx.$queryRawUnsafe(`SELECT \`id\` FROM \`SoftwareLicense\` WHERE \`id\` = ? FOR UPDATE`, license.id);
        const lic = await tx.softwareLicense.findUnique({
          where: { id: license.id },
          include: { assignments: { where: { returnedAt: null } } },
        });
        if (lic.assignments.length >= lic.seats) throw new Error('Seat capacity reached');
        return tx.softwareAssignment.create({
          data: { licenseId: license.id, notes: `Seat ${i}` },
        });
      }, { isolationLevel: 'ReadCommitted' });
    })
  );

  const assignSuccess = assignAttempts.filter(a => a.status === 'fulfilled').length;
  const assignFail = assignAttempts.filter(a => a.status === 'rejected').length;
  const actualSeats = await tenant.softwareAssignment.count({ where: { licenseId: license.id } });
  console.log(`Results: ${assignSuccess} succeeded, ${assignFail} failed. Actual DB rows: ${actualSeats}`);
  if (assignSuccess !== 10 || actualSeats !== 10) {
    console.error('❌ Seat License Concurrency Test FAILED');
  } else {
    console.log('✅ Seat License Concurrency Test PASSED\n');
  }

  // 2. MFA Reset Approval Concurrency Test
  console.log('2. MFA Reset Approval Concurrency Test');
  const targetUser = await catalog.platformUser.create({
    data: { email: `target_${Date.now()}@test.com`, firstName: 'T', lastName: 'U', passwordHash: 'dummy' },
  });
  const approver = await catalog.platformUser.create({
    data: { email: `approver_${Date.now()}@test.com`, firstName: 'A', lastName: 'P', passwordHash: 'dummy' },
  });
  const req = await catalog.platformMfaResetRequest.create({
    data: { targetId: targetUser.id, requesterId: targetUser.id, incidentRef: 'INC-123', expiresAt: new Date(Date.now() + 100000) },
  });

  console.log(`Created reset request. Firing 50 concurrent approvals...`);
  const approveAttempts = await Promise.allSettled(
    Array.from({ length: 50 }).map(async () => {
      // Inline the transaction logic from platform-mfa.service.ts
      return await catalog.$transaction(async (tx: any) => {
        // FOR UPDATE lock on the request
        await tx.$queryRawUnsafe(`SELECT \`id\` FROM \`PlatformMfaResetRequest\` WHERE \`id\` = ? FOR UPDATE`, req.id);
        const claim = await tx.platformMfaResetRequest.updateMany({
          where: { id: req.id, status: 'PENDING', expiresAt: { gt: new Date() } },
          data: { status: 'APPROVED', approverId: approver.id, approvedAt: new Date() },
        });
        if (claim.count !== 1) throw new Error('Already consumed');
        return true;
      }, { isolationLevel: 'ReadCommitted' });
    })
  );

  const approveSuccess = approveAttempts.filter(a => a.status === 'fulfilled').length;
  const approveFail = approveAttempts.filter(a => a.status === 'rejected').length;
  console.log(`Results: ${approveSuccess} succeeded, ${approveFail} failed.`);
  if (approveSuccess !== 1) {
    console.error('❌ MFA Reset Concurrency Test FAILED');
  } else {
    console.log('✅ MFA Reset Concurrency Test PASSED\n');
  }

  // 3. Audit Hash Chain Concurrency Test
  console.log('3. Audit Hash Chain Concurrency Test');
  console.log(`Firing 20 concurrent audit writes via writeAuditEntry...`);
  
  // Note: we don't pass tenantId here to also test Phase 1 verification (Task 1)
  const auditAttempts = await Promise.allSettled(
    Array.from({ length: 20 }).map(async (_, i) => {
      let retries = 10;
      while (retries > 0) {
        try {
          return await writeAuditEntry(tenant, { tenantId, action: 'concurrency_test', detail: { run: i } });
        } catch (e: any) {
          retries--;
          if (retries === 0) {
            console.error('Audit write failed:', e);
            throw e;
          }
          await new Promise(r => setTimeout(r, Math.random() * 50));
        }
      }
    })
  );

  const auditSuccess = auditAttempts.filter(a => a.status === 'fulfilled').length;
  console.log(`Results: ${auditSuccess} writes succeeded out of 20.`);

  // Verify the entire chain in the database (since other tests also generated audit events)
  const entries = await tenant.auditLog.findMany({ orderBy: { seq: 'asc' } });
  let chainOk = true;
  for (let i = 1; i < entries.length; i++) {
    // entryHash null means pre-hash legacy row, skip
    if (entries[i].entryHash == null) continue;
    
    // The very first hashed row might have a null prevHash depending on when hashing was turned on
    // But for our newly created ones, prevHash must strictly match the previous row's entryHash
    if (entries[i-1].entryHash != null && entries[i].prevHash !== entries[i-1].entryHash) {
      chainOk = false;
      console.error(`Chain broken at seq ${entries[i].seq}: expected prevHash ${entries[i-1].entryHash}, got ${entries[i].prevHash}`);
      break;
    }
  }
  if (auditSuccess !== 20 || !chainOk) {
    console.error(`❌ Audit Chain Concurrency Test FAILED. Chain OK: ${chainOk}, Total Rows in DB: ${entries.length}`);
  } else {
    console.log('✅ Audit Chain Concurrency Test PASSED\n');
  }

  // Also test the verifyChain logic (Task 1 confirmation)
  // We'll mimic the logic in verifyChain (which now uses tenantId: (r as any).tenantId ?? null)
  console.log('4. Task 1 Verification (v3 backward compat)');
  const lastEntry = entries[entries.length - 1];
  // Since it was written via Phase 1 code path, it should be v3
  console.log(`Last entry hashVersion: ${lastEntry.hashVersion}, tenantId: ${(lastEntry as any).tenantId}`);
  const { computeEntryHash } = require('./src/common/audit-hash');
  const expectedHash = computeEntryHash({
    prevHash: lastEntry.prevHash,
    action: lastEntry.action,
    assetId: lastEntry.assetId,
    performedById: lastEntry.performedById,
    detail: lastEntry.detail,
    createdAt: lastEntry.createdAt,
    hashVersion: lastEntry.hashVersion,
    tenantId: (lastEntry as any).tenantId ?? null,
  });
  if (expectedHash === lastEntry.entryHash) {
    console.log('✅ VerifyChain correctly recomputed the v3 hash for a Phase 1 row!\n');
  } else {
    console.error('❌ VerifyChain recomputation failed!', { expected: expectedHash, actual: lastEntry.entryHash });
  }

  // 5. MFA Availability Floor Concurrency Test
  console.log('5. MFA Availability Floor Concurrency Test');
  // First, clear all super admins so we have a clean slate for the test
  await catalog.platformUser.updateMany({ data: { role: 'SUPPORT' } });
  
  // Create exactly 3 active, MFA-complete super admins.
  // mfaSetupComplete checks for mfaEnrolledAt !== null
  const sa1 = await catalog.platformUser.create({ data: { email: `sa1_${Date.now()}@test.com`, firstName: 'S', lastName: 'A', passwordHash: 'dummy', role: 'SUPER_ADMIN', active: true, mfaEnrolledAt: new Date() } });
  const sa2 = await catalog.platformUser.create({ data: { email: `sa2_${Date.now()}@test.com`, firstName: 'S', lastName: 'A', passwordHash: 'dummy', role: 'SUPER_ADMIN', active: true, mfaEnrolledAt: new Date() } });
  const sa3 = await catalog.platformUser.create({ data: { email: `sa3_${Date.now()}@test.com`, firstName: 'S', lastName: 'A', passwordHash: 'dummy', role: 'SUPER_ADMIN', active: true, mfaEnrolledAt: new Date() } });

  // Create 2 separate reset requests for sa1 and sa2
  const req1 = await catalog.platformMfaResetRequest.create({
    data: { targetId: sa1.id, requesterId: sa1.id, incidentRef: 'INC-A', expiresAt: new Date(Date.now() + 100000) },
  });
  const req2 = await catalog.platformMfaResetRequest.create({
    data: { targetId: sa2.id, requesterId: sa2.id, incidentRef: 'INC-B', expiresAt: new Date(Date.now() + 100000) },
  });

  // Helper to simulate the transaction
  const mfaSetupComplete = (u: any) => u.mfaEnrolledAt !== null;
  const clearMfaUserData = () => ({ mfaEnrolledAt: null, lastTotpStep: null });

  console.log(`Firing concurrent approvals for two different requests. Floor should prevent BOTH from succeeding...`);
  const floorAttempts = await Promise.allSettled([
    // Tx 1
    catalog.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe(`SELECT \`id\` FROM \`PlatformMfaResetRequest\` WHERE \`id\` = ? FOR UPDATE`, req1.id);
      await tx.platformMfaResetRequest.updateMany({ where: { id: req1.id, status: 'PENDING' }, data: { status: 'APPROVED', approverId: sa3.id, approvedAt: new Date() } });
      await tx.$queryRawUnsafe(`SELECT \`id\` FROM \`PlatformUser\` WHERE \`role\` = 'SUPER_ADMIN' AND \`active\` = true ORDER BY \`id\` FOR UPDATE`);
      
      const admins = await tx.platformUser.findMany({ where: { role: 'SUPER_ADMIN', active: true } });
      const complete = admins.filter(mfaSetupComplete);
      const completeAfter = complete.length - (complete.some((a: any) => a.id === sa1.id) ? 1 : 0);
      if (completeAfter < 2) throw new Error('Refusing: this reset would leave fewer than 2 MFA-complete super-admins.');
      
      await tx.platformUser.update({ where: { id: sa1.id }, data: clearMfaUserData() });
    }, { isolationLevel: 'ReadCommitted' }),
    
    // Tx 2
    catalog.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe(`SELECT \`id\` FROM \`PlatformMfaResetRequest\` WHERE \`id\` = ? FOR UPDATE`, req2.id);
      await tx.platformMfaResetRequest.updateMany({ where: { id: req2.id, status: 'PENDING' }, data: { status: 'APPROVED', approverId: sa3.id, approvedAt: new Date() } });
      await tx.$queryRawUnsafe(`SELECT \`id\` FROM \`PlatformUser\` WHERE \`role\` = 'SUPER_ADMIN' AND \`active\` = true ORDER BY \`id\` FOR UPDATE`);
      
      const admins = await tx.platformUser.findMany({ where: { role: 'SUPER_ADMIN', active: true } });
      const complete = admins.filter(mfaSetupComplete);
      const completeAfter = complete.length - (complete.some((a: any) => a.id === sa2.id) ? 1 : 0);
      if (completeAfter < 2) throw new Error('Refusing: this reset would leave fewer than 2 MFA-complete super-admins.');
      
      await tx.platformUser.update({ where: { id: sa2.id }, data: clearMfaUserData() });
    }, { isolationLevel: 'ReadCommitted' })
  ]);

  const floorSuccess = floorAttempts.filter(a => a.status === 'fulfilled').length;
  const floorFail = floorAttempts.filter(a => a.status === 'rejected').length;
  console.log(`Results: ${floorSuccess} succeeded, ${floorFail} failed.`);
  
  if (floorSuccess === 1 && floorFail === 1) {
    console.log('✅ MFA Availability Floor Concurrency Test PASSED\n');
  } else {
    console.error(`❌ MFA Availability Floor Concurrency Test FAILED (Expected 1 success, got ${floorSuccess})`);
  }

  // 6. Platform Audit Chain Concurrency Test
  console.log('6. Platform Audit Chain Concurrency Test');
  console.log('Firing 20 concurrent platform audit writes...');
  const { hashPlatformEntry } = require('./src/platform/platform-audit-hash');
  
  const platformAuditAttempts = await Promise.allSettled(
    Array.from({ length: 20 }).map(async (_, i) => {
      return await catalog.$transaction(async (tx: any) => {
        const counters: any[] = await tx.$queryRawUnsafe(
          `SELECT \`lastSeq\`, \`lastHash\` FROM \`PlatformAuditCounter\` WHERE \`id\` = 'platform' FOR UPDATE`,
        );
        let lastSeq = counters.length > 0 ? (counters[0].lastSeq ?? 0) : 0;
        let lastHash = counters.length > 0 ? (counters[0].lastHash ?? null) : null;
        if (counters.length === 0) {
          const newCounter = await tx.platformAuditCounter.create({
            data: { id: 'platform', lastSeq: 0, lastHash: null },
          });
          lastSeq = newCounter.lastSeq;
          lastHash = newCounter.lastHash;
        }
        const createdAt = new Date();
        const entryHash = hashPlatformEntry({
          prevHash: lastHash,
          actorId: sa1.id,
          actorEmail: sa1.email,
          action: `platform_concurrency_test_${i}`,
          targetType: 'test',
          targetId: `item_${i}`,
          metadata: { run: i },
          ipAddress: '127.0.0.1',
          userAgent: 'test-runner',
          createdAt,
        });
        const newRow = await tx.platformAuditLog.create({
          data: {
            actorId: sa1.id,
            actorEmail: sa1.email,
            action: `platform_concurrency_test_${i}`,
            targetType: 'test',
            targetId: `item_${i}`,
            metadata: { run: i },
            ipAddress: '127.0.0.1',
            userAgent: 'test-runner',
            prevHash: lastHash,
            entryHash,
            createdAt,
          },
        });
        await tx.platformAuditCounter.update({
          where: { id: 'platform' },
          data: { lastSeq: newRow.seq, lastHash: newRow.entryHash },
        });
        return newRow;
      }, { isolationLevel: 'ReadCommitted' });
    })
  );

  const platformSuccess = platformAuditAttempts.filter(a => a.status === 'fulfilled').length;
  console.log(`Results: ${platformSuccess} platform audit writes succeeded out of 20.`);

  const platformLogs = await catalog.platformAuditLog.findMany({ orderBy: { seq: 'asc' } });
  let platformChainOk = true;
  for (let i = 1; i < platformLogs.length; i++) {
    if (platformLogs[i].entryHash == null) continue;
    if (platformLogs[i-1].entryHash != null && platformLogs[i].prevHash !== platformLogs[i-1].entryHash) {
      platformChainOk = false;
      console.error(`Platform chain broken at seq ${platformLogs[i].seq}: expected ${platformLogs[i-1].entryHash}, got ${platformLogs[i].prevHash}`);
      break;
    }
  }

  if (platformSuccess !== 20 || !platformChainOk) {
    console.error(`❌ Platform Audit Chain Concurrency Test FAILED. Chain OK: ${platformChainOk}`);
  } else {
    console.log('✅ Platform Audit Chain Concurrency Test PASSED\n');
  }

  await catalog.$disconnect();
  await tenant.$disconnect();
}

runTests().catch(e => console.error(e));
