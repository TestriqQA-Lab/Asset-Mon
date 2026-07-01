import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CatalogPrismaService } from '../catalog/catalog-prisma.service';
import { PlatformAuditService } from './platform-audit.service';
import { assertSuperAdmin } from './platform-mfa.util';

type Actor = { id: string; email: string; role?: string };

export interface AnnouncementInput {
  title: string;
  body: string;
  severity: string;
  audienceType: string;
  audiencePlans?: string[];
  audienceTenantIds?: string[];
  startsAt?: string | null;
  endsAt?: string | null;
  active?: boolean;
}

// Broadcast announcements. Authoring lives here (operator, SUPER_ADMIN-only writes,
// audited). The same service also serves the tenant-facing read (`activeForTenant`)
// so the audience-matching rule lives in exactly one place. Rows are in the catalog
// DB, so this spans all tenants like the support inbox.
@Injectable()
export class PlatformAnnouncementsService {
  constructor(
    private readonly catalog: CatalogPrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  // Operator view: everything (incl. inactive/expired), newest first. Filters are UI-only.
  async listForOperator() {
    return this.catalog.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  }

  // A PLAN notice must name at least one plan; a TENANTS notice at least one company.
  private assertAudienceConsistent(input: {
    audienceType: string;
    audiencePlans?: string[];
    audienceTenantIds?: string[];
  }) {
    if (input.audienceType === 'PLAN' && !(input.audiencePlans && input.audiencePlans.length)) {
      throw new BadRequestException('Select at least one plan for a plan-targeted announcement.');
    }
    if (input.audienceType === 'TENANTS' && !(input.audienceTenantIds && input.audienceTenantIds.length)) {
      throw new BadRequestException('Select at least one company for a company-targeted announcement.');
    }
  }

  async create(actor: Actor, dto: AnnouncementInput, req?: any) {
    assertSuperAdmin(actor);
    this.assertAudienceConsistent(dto);
    const row = await this.catalog.announcement.create({
      data: {
        title: dto.title,
        body: dto.body,
        severity: dto.severity,
        audienceType: dto.audienceType,
        // Only persist the array relevant to the chosen audience type.
        audiencePlans: dto.audienceType === 'PLAN' ? dto.audiencePlans ?? [] : [],
        audienceTenantIds: dto.audienceType === 'TENANTS' ? dto.audienceTenantIds ?? [] : [],
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        active: dto.active ?? true,
        createdById: actor.id,
        createdByEmail: actor.email,
      },
    });
    await this.audit.record(
      actor,
      'platform.announcement.create',
      { type: 'announcement', id: row.id },
      { title: row.title, severity: row.severity, audienceType: row.audienceType },
      req,
    );
    return row;
  }

  async update(actor: Actor, id: string, dto: Partial<AnnouncementInput>, req?: any) {
    assertSuperAdmin(actor);
    const existing = await this.catalog.announcement.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Announcement not found');

    // Resolve the FINAL audience shape and normalise the arrays so only the array
    // matching the final audienceType is ever stored. This prevents a stale
    // targeting list from lingering (and silently resurrecting) when the type is
    // later changed without re-supplying the arrays.
    const nextType = dto.audienceType ?? existing.audienceType;
    const existingPlans = (existing.audiencePlans as string[]) ?? [];
    const existingTenantIds = (existing.audienceTenantIds as string[]) ?? [];
    const nextPlans = nextType === 'PLAN' ? dto.audiencePlans ?? existingPlans : [];
    const nextTenantIds = nextType === 'TENANTS' ? dto.audienceTenantIds ?? existingTenantIds : [];
    this.assertAudienceConsistent({ audienceType: nextType, audiencePlans: nextPlans, audienceTenantIds: nextTenantIds });

    const data: any = {};
    const changed: string[] = [];
    if (dto.title !== undefined && dto.title !== existing.title) { data.title = dto.title; changed.push('title'); }
    if (dto.body !== undefined && dto.body !== existing.body) { data.body = dto.body; changed.push('body'); }
    if (dto.severity !== undefined && dto.severity !== existing.severity) { data.severity = dto.severity; changed.push('severity'); }
    if (dto.startsAt !== undefined) {
      const next = dto.startsAt ? new Date(dto.startsAt) : null;
      if ((next?.getTime() ?? null) !== (existing.startsAt?.getTime() ?? null)) { data.startsAt = next; changed.push('startsAt'); }
    }
    if (dto.endsAt !== undefined) {
      const next = dto.endsAt ? new Date(dto.endsAt) : null;
      if ((next?.getTime() ?? null) !== (existing.endsAt?.getTime() ?? null)) { data.endsAt = next; changed.push('endsAt'); }
    }
    if (dto.active !== undefined && dto.active !== existing.active) { data.active = dto.active; changed.push('active'); }

    // Audience: apply (writing BOTH normalised arrays so the DB stays consistent)
    // whenever the type changes or either list's effective value differs — but only
    // mark the parts that truly changed so we don't version-bump on a no-op.
    const typeChanged = nextType !== existing.audienceType;
    const plansChanged = JSON.stringify(nextPlans) !== JSON.stringify(existingPlans);
    const tenantIdsChanged = JSON.stringify(nextTenantIds) !== JSON.stringify(existingTenantIds);
    if (typeChanged || plansChanged || tenantIdsChanged) {
      data.audienceType = nextType;
      data.audiencePlans = nextPlans;
      data.audienceTenantIds = nextTenantIds;
      if (typeChanged) changed.push('audienceType');
      if (plansChanged) changed.push('audiencePlans');
      if (tenantIdsChanged) changed.push('audienceTenantIds');
    }

    // Material edits (content / targeting / window) bump `version` so a banner a
    // user already dismissed re-appears. Toggling only `active` is NOT material.
    const materialChanged = changed.some((c) => c !== 'active');
    if (materialChanged) data.version = { increment: 1 };

    const row = await this.catalog.announcement.update({ where: { id }, data });
    await this.audit.record(
      actor,
      'platform.announcement.update',
      { type: 'announcement', id },
      { changed, versionBumped: materialChanged },
      req,
    );
    return row;
  }

  async remove(actor: Actor, id: string, req?: any) {
    assertSuperAdmin(actor);
    const existing = await this.catalog.announcement.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Announcement not found');
    await this.catalog.announcement.delete({ where: { id } });
    await this.audit.record(
      actor,
      'platform.announcement.delete',
      { type: 'announcement', id },
      { title: existing.title },
      req,
    );
    return { ok: true };
  }

  // Tenant-facing read: only active, in-window, audience-matching rows, with the
  // audience/author fields stripped so a tenant can never learn who else was
  // targeted. No assertSuperAdmin — every tenant role may read its own banners.
  async activeForTenant(tenant: { id: string; plan: string }) {
    const now = new Date();
    const rows = await this.catalog.announcement.findMany({
      where: {
        active: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows
      .filter((r) => {
        if (r.audienceType === 'ALL') return true;
        if (r.audienceType === 'PLAN') return Array.isArray(r.audiencePlans) && (r.audiencePlans as string[]).includes(tenant.plan);
        if (r.audienceType === 'TENANTS') return Array.isArray(r.audienceTenantIds) && (r.audienceTenantIds as string[]).includes(tenant.id);
        return false;
      })
      .map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        severity: r.severity,
        version: r.version,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
      }));
  }
}
