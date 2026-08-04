import { Controller, Get, Injectable, Module, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { computeEntryHash, AUDIT_HASH_VERSION } from '../common/audit-hash';
import { NavPermissionsGuard } from '../tenant-settings/nav-permissions.guard';
import { RequireNav } from '../tenant-settings/require-nav.decorator';

@Injectable()
export class AuditService {
  constructor(private readonly ctx: TenantContextService) {}

  list(limit = 100) {
    return this.ctx.prisma().auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, limit),
      include: {
        performedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
        asset: { select: { id: true, assetTag: true, name: true } },
      },
    });
  }

  async verifyChain() {
    const rows = await this.ctx.prisma().auditLog.findMany({
      // The extension scopes this to the caller's tenant, so `seq` ordering is within
      // one chain even though the column auto-increments globally across the shared table.
      orderBy: { seq: 'asc' },
      select: { id: true, tenantId: true, seq: true, prevHash: true, entryHash: true, action: true, assetId: true, performedById: true, detail: true, createdAt: true, hashVersion: true },
    });
    let lastHash: string | null = null;
    let scanned = 0;
    const broken: any[] = [];
    for (const r of rows) {
      scanned++;
      // Pre-hash-chain entries (entryHash null) are skipped from verification but acknowledged.
      if (r.entryHash == null) { lastHash = null; continue; }
      const expected = computeEntryHash({
        prevHash: r.prevHash,
        action: r.action,
        assetId: r.assetId,
        performedById: r.performedById,
        detail: r.detail,
        createdAt: r.createdAt,
        // Verify each row against the recipe it was written with, so entries predating
        // the v2 change keep validating. v3 entries include tenantId in the hash.
        hashVersion: r.hashVersion,
        // Only the v3 branch reads this, so rows migrated from the per-tenant Postgres
        // databases (v1/v2) verify unchanged despite having had a tenantId backfilled.
        tenantId: r.tenantId,
      });
      if (r.entryHash !== expected || (lastHash != null && r.prevHash !== lastHash)) {
        broken.push({ seq: r.seq, id: r.id, action: r.action, expected, actual: r.entryHash, prevHashOk: lastHash == null || r.prevHash === lastHash });
      }
      lastHash = r.entryHash;
    }
    return { scanned, intact: broken.length === 0, broken };
  }

  /**
   * One-shot rebuild of the audit chain hashes using the canonical (stable)
   * JSON serialiser. Required exactly once after upgrading from the legacy
   * JSON.stringify hashing; idempotent thereafter (verifyChain returns intact
   * before and after).
   *
   * Admin-only because it rewrites entryHash/prevHash. The action itself is
   * appended to the chain at the end so the rebuild is publicly attributable
   * - you cannot rebuild the chain without leaving a fingerprint.
   */
  async rebuildChain(performedById: string | null) {
    const db = this.ctx.prisma();
    const tenantId = this.ctx.tenantId!;
    // Hold the tenant's AuditCounter row for the whole rebuild. Without it a
    // concurrent writeAuditEntry would append onto the pre-rebuild tail hash and
    // fork the chain the rebuild is trying to repair.
    return db.$transaction(async (tx: any) => {
    await tx.$queryRawUnsafe(
      `SELECT \`lastSeq\` FROM \`AuditCounter\` WHERE \`tenantId\` = ? FOR UPDATE`,
      tenantId,
    );
    const rows = await tx.auditLog.findMany({ orderBy: { seq: 'asc' } });
    let prev: string | null = null;
    let updated = 0;
    for (const r of rows) {
      // Re-baseline every row onto the current recipe. This is also the repair path for
      // entries broken by the v1 flaw (a deleted asset rewrote their hashed assetId):
      // v2 does not hash that column, so once re-stamped they verify and stay verifying.
      // The original assetId of an already-nulled row cannot be recovered — the value is
      // gone — so this restores trust going forward rather than reconstructing the past.
      const newHash = computeEntryHash({
        prevHash: prev,
        action: r.action,
        assetId: r.assetId,
        performedById: r.performedById,
        detail: r.detail,
        createdAt: r.createdAt,
        hashVersion: AUDIT_HASH_VERSION,
        // v3 hashes the tenantId. Omitting it here would re-stamp every row with a
        // hash computed over an empty tenant, and verifyChain — which passes the
        // stored tenantId — would report the freshly rebuilt chain as broken.
        tenantId,
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
    // Tail-marker so the rebuild itself is on the chain.
    const createdAt = new Date();
    const tailDetail = { rebuilt: true, count: rows.length, updated, hashVersion: AUDIT_HASH_VERSION };
    const tailHash = computeEntryHash({
      prevHash: prev, action: 'audit.chain.rebuild',
      assetId: null, performedById, detail: tailDetail, createdAt,
      hashVersion: AUDIT_HASH_VERSION, tenantId,
    });
    const tailRow = await tx.auditLog.create({
      data: {
        tenantId,
        action: 'audit.chain.rebuild', detail: tailDetail, performedById,
        prevHash: prev, entryHash: tailHash, hashVersion: AUDIT_HASH_VERSION, createdAt,
      },
    });
    // Re-point the counter at the new tail. Skipping this would leave lastHash on the
    // pre-rebuild hash, so the next append would chain onto a hash no row carries.
    await tx.auditCounter.update({
      where: { tenantId },
      data: { lastSeq: tailRow.seq, lastHash: tailHash },
    });
    return { scanned: rows.length, updated, tailEntry: { entryHash: tailHash } };
    }, { timeout: 120_000, maxWait: 10_000 });
  }
}

@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, NavPermissionsGuard)
@RequireNav('audit-log')
@Roles('ADMIN') // full audit-log read is ADMIN-only (hard gate, not just the nav matrix)
@Controller('audit')
class AuditController {
  constructor(private readonly svc: AuditService) {}
  @Get() list(@Query('limit') limit?: string) {
    return this.svc.list(limit ? Number(limit) : 100);
  }
  @Get('verify') verify() { return this.svc.verifyChain(); }

  // One-shot maintenance op — only used to reseal an existing chain after a
  // hash-format upgrade. Idempotent: subsequent calls verify clean and only
  // append the rebuild marker.
  @Post('rebuild')
  @Roles('ADMIN')
  rebuild(@CurrentUser('sub') uid: string) { return this.svc.rebuildChain(uid); }
}

@Module({ controllers: [AuditController], providers: [AuditService] })
export class AuditModule {}
