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
class AuditService {
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
      orderBy: { seq: 'asc' },
      select: { id: true, seq: true, prevHash: true, entryHash: true, action: true, assetId: true, performedById: true, detail: true, createdAt: true, hashVersion: true },
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
        // the v2 change keep validating.
        hashVersion: r.hashVersion,
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
    const rows = await db.auditLog.findMany({ orderBy: { seq: 'asc' } });
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
      });
      if (r.entryHash !== newHash || r.prevHash !== prev || r.hashVersion !== AUDIT_HASH_VERSION) {
        await db.auditLog.update({
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
      hashVersion: AUDIT_HASH_VERSION,
    });
    await db.auditLog.create({
      data: {
        action: 'audit.chain.rebuild', detail: tailDetail, performedById,
        prevHash: prev, entryHash: tailHash, hashVersion: AUDIT_HASH_VERSION, createdAt,
      },
    });
    return { scanned: rows.length, updated, tailEntry: { entryHash: tailHash } };
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
