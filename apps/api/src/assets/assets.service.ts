import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { EventBusService } from '../events/events.module';
import { writeAuditEntry } from '../common/audit-hash';
import { BillingService } from '../billing/billing.module';
import { signFileToken } from '../common/signed-url';

export type ListAssetsQuery = {
  q?: string;
  status?: string;
  categoryId?: string;
  locationId?: string;
  departmentId?: string;
  parentId?: string;
  onlyTopLevel?: boolean;
  assignedTo?: string;
  page?: number;
  pageSize?: number;
};

@Injectable()
export class AssetsService {
  constructor(
    private readonly ctx: TenantContextService,
    private readonly events: EventBusService,
    private readonly billing: BillingService,
  ) {}

  async list(q: ListAssetsQuery) {
    const where: any = {};
    if (q.status) where.status = q.status;
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.locationId) where.locationId = q.locationId;
    if (q.departmentId) where.departmentId = q.departmentId;
    if (q.parentId) where.parentId = q.parentId;
    if (q.onlyTopLevel) where.parentId = null;
    // Department-scoped users only see their dept's assets.
    const scope = await this.scopedDepartmentId();
    if (scope) where.departmentId = scope;
    // EMPLOYEEs without an explicit dept scope now see all assets globally
    // as per user request (removed the where.assignments restriction).
    if (q.q) {
      const term = q.q.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { assetTag: { contains: term, mode: 'insensitive' } },
        { serialNumber: { contains: term, mode: 'insensitive' } },
        // `notes` is hidden from the EMPLOYEE view (5B); excluding it from their search
        // prevents a blind yes/no oracle on notes content.
        ...(this.ctx.role === 'EMPLOYEE' ? [] : [{ notes: { contains: term, mode: 'insensitive' } }]),
      ];
    }
    const page = Math.max(1, q.page || 1);
    const pageSize = Math.min(200, q.pageSize || 25);
    const db = this.ctx.prisma();
    const [items, total] = await Promise.all([
      db.asset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          category: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          vendor: { select: { id: true, name: true } },
          statusDef: { select: { id: true, key: true, label: true, color: true } },
          parent: { select: { id: true, assetTag: true, name: true } },
          _count: { select: { children: true, attachments: true } },
          assignments: {
            where: { returnedAt: null },
            take: 1,
            include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
          },
        },
      }),
      db.asset.count({ where }),
    ]);
    if (this.ctx.role === 'EMPLOYEE') {
      return { items: items.map((a: any) => this.toEmployeeAssetView(a)), total, page, pageSize };
    }
    const tid = this.ctx.tenantId;
    return { items: items.map((a: any) => this.withSignedPhoto(a, tid)), total, page, pageSize };
  }

  /**
   * Swap the auth-guarded photo path (`/api/assets/files/…`) for a short-lived
   * signed public URL (`/api/assets/file-public/…?sig=`) so list thumbnails load
   * in <img> tags, which cannot send the Bearer header. Mirrors `/photo-url`.
   */
  private withSignedPhoto(a: any, tid: string | null | undefined) {
    if (!a?.photoUrl || !tid) return a;
    const filename = String(a.photoUrl).split('/').pop();
    if (!filename) return a;
    const token = signFileToken(filename, tid, 3600);
    return { ...a, photoUrl: `/api/assets/file-public/${filename}?sig=${encodeURIComponent(token)}` };
  }

  async get(id: string): Promise<any> {
    const db = this.ctx.prisma();
    const a = await db.asset.findUnique({
      where: { id },
      include: {
        category: true, location: true, department: true, vendor: true,
        statusDef: true,
        parent: { select: { id: true, assetTag: true, name: true, status: true } },
        children: {
          orderBy: { createdAt: 'desc' },
          include: { category: { select: { id: true, name: true } } },
        },
        attachments: {
          orderBy: { createdAt: 'desc' },
          include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
        },
        assignments: {
          orderBy: { checkedOutAt: 'desc' },
          include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
        },
      },
    });
    if (!a) throw new NotFoundException('Asset not found');
    // Enforce scope on direct gets too.
    const scope = await this.scopedDepartmentId();
    if (scope && a.departmentId !== scope) throw new NotFoundException('Asset not found');
    // EMPLOYEE may open ANY asset (Decision A) but sees a LIMITED view — no
    // financials / notes / vendor / location / other users' PII. (A department-
    // scoped employee is still limited to their dept by the check above.)
    if (this.ctx.role === 'EMPLOYEE') {
      return this.toEmployeeAssetView(a);
    }
    return a;
  }

  // The limited asset shape an EMPLOYEE receives (Decision A, 2026-07-08): identity
  // + tracking only — tag / name / model / serial / status / category / current
  // holder's NAME + since. No cost / purchase / warranty / depreciation / notes /
  // custom fields / vendor / location, and never the holder's email/id.
  private toEmployeeAssetView(a: any) {
    const open = (a.assignments || []).find((x: any) => !x.returnedAt) || null;
    return {
      id: a.id,
      assetTag: a.assetTag,
      name: a.name,
      model: a.model ?? null,
      serialNumber: a.serialNumber ?? null,
      status: a.status,
      statusDef: a.statusDef ?? null,
      categoryId: a.categoryId,
      category: a.category ? { id: a.category.id, name: a.category.name } : null,
      assignments: open ? [{ checkedOutAt: open.checkedOutAt, user: open.user ? { firstName: open.user.firstName, lastName: open.user.lastName } : null }] : [],
      _count: a._count ? { children: a._count.children ?? 0 } : undefined,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }

  /** Returns the caller's scopedDepartmentId, or null if unscoped (admin/ops). */
  private async scopedDepartmentId(): Promise<string | null> {
    const role = this.ctx.role;
    if (!role || ['ADMIN', 'ASSET_MANAGER'].includes(role)) return null;
    if (!this.ctx.userId) return null;
    const u = await this.ctx.prisma().user.findUnique({
      where: { id: this.ctx.userId }, select: { scopedDepartmentId: true },
    });
    return u?.scopedDepartmentId || null;
  }

  // Pre-flight billing check for batch operations (CSV import) so we do not run
  // N independent quota checks while inserting.
  async assertCanAddAssets(count: number) {
    if (!this.ctx.tenantId || count <= 0) return;
    for (let i = 0; i < count; i++) {
      await this.billing.assertCanAddAsset(this.ctx.tenantId);
    }
  }

  async create(data: any, performedById?: string, opts?: { skipBillingCheck?: boolean }) {
    if (!data.name) throw new BadRequestException('name is required');
    if (!opts?.skipBillingCheck && this.ctx.tenantId) await this.billing.assertCanAddAsset(this.ctx.tenantId);
    const db = this.ctx.prisma();

    const assetTag = data.assetTag || (await this.nextAssetTag());
    const created = await db.asset.create({
      data: {
        assetTag,
        name: data.name,
        serialNumber: data.serialNumber || null,
        model: data.model || null,
        status: data.status || 'AVAILABLE',
        categoryId: data.categoryId || null,
        locationId: data.locationId || null,
        departmentId: data.departmentId || null,
        vendorId: data.vendorId || null,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
        purchaseCost: data.purchaseCost ?? null,
        warrantyEnd: data.warrantyEnd ? new Date(data.warrantyEnd) : null,
        notes: data.notes || null,
        orderNumber: data.orderNumber || null,
        requestable: data.requestable ?? false,
        customFields: data.customFields || {},
        photoUrl: data.photoUrl || null,
        depreciationMethod: data.depreciationMethod || 'NONE',
        salvageValue: data.salvageValue ?? null,
        usefulLifeMonths: data.usefulLifeMonths ?? null,
        depreciationStart: data.depreciationStart ? new Date(data.depreciationStart) : (data.purchaseDate ? new Date(data.purchaseDate) : null),
        parentId: data.parentId || null,
        statusDefId: data.statusDefId || null,
      },
    });
    await writeAuditEntry(db, { assetId: created.id, action: 'CREATED', performedById, detail: { name: created.name }, impersonatedBy: this.ctx.impersonatedBy ?? null });
    this.events.emit('asset.created', { id: created.id, assetTag: created.assetTag, name: created.name }).catch(() => {});
    return created;
  }

  async update(id: string, data: any, performedById?: string) {
    const db = this.ctx.prisma();
    const before = await db.asset.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Asset not found');
    const patch: any = { ...data };
    if (data.purchaseDate !== undefined) patch.purchaseDate = data.purchaseDate ? new Date(data.purchaseDate) : null;
    if (data.warrantyEnd !== undefined) patch.warrantyEnd = data.warrantyEnd ? new Date(data.warrantyEnd) : null;
    if (data.depreciationStart !== undefined) patch.depreciationStart = data.depreciationStart ? new Date(data.depreciationStart) : null;
    if (data.parentId !== undefined) {
      if (data.parentId === id) throw new BadRequestException('Asset cannot be its own parent');
      patch.parentId = data.parentId || null;
    }
    if (data.statusDefId !== undefined) patch.statusDefId = data.statusDefId || null;
    const updated = await db.asset.update({ where: { id }, data: patch });
    await writeAuditEntry(db, { assetId: id, action: 'UPDATED', performedById, detail: this.diff(before, updated), impersonatedBy: this.ctx.impersonatedBy ?? null });
    this.events.emit('asset.updated', { id: updated.id, assetTag: updated.assetTag, status: updated.status }).catch(() => {});
    return updated;
  }

  async remove(id: string, performedById?: string) {
    const db = this.ctx.prisma();
    const existing = await db.asset.findUnique({ where: { id }, select: { id: true, assetTag: true, name: true } });
    if (!existing) throw new NotFoundException('Asset not found');
    await writeAuditEntry(db, { assetId: id, action: 'DELETED', performedById, detail: { assetTag: existing.assetTag, name: existing.name }, impersonatedBy: this.ctx.impersonatedBy ?? null });
    // Detach all audit logs from the asset so they survive the delete (cascade would remove them).
    await db.auditLog.updateMany({ where: { assetId: id }, data: { assetId: null } });
    const deleted = await db.asset.delete({ where: { id } });
    this.events.emit('asset.deleted', { id, assetTag: existing.assetTag }).catch(() => {});
    return deleted;
  }

  async bulkUpdate(ids: string[], patch: { status?: string; locationId?: string | null; departmentId?: string | null }, performedById: string) {
    const db = this.ctx.prisma();
    if (!ids?.length) throw new BadRequestException('No ids');
    if (ids.length > 500) throw new BadRequestException('Too many ids (max 500)');
    const data: any = {};
    // A bulk status change is always a raw system status (the "Set status" / "Archive"
    // controls send the enum value, never a custom status template) — so clear any
    // per-asset status template too, or the pill would keep showing the old label.
    if (patch.status) { data.status = patch.status; data.statusDefId = null; }
    if (patch.locationId !== undefined) data.locationId = patch.locationId || null;
    if (patch.departmentId !== undefined) data.departmentId = patch.departmentId || null;
    // Short-circuit no-op patches so we don't bloat the audit chain with empty BULK_UPDATED entries.
    if (Object.keys(data).length === 0) return { updated: 0 };
    // Limit audit writes to ids that actually exist.
    const existing = await db.asset.findMany({ where: { id: { in: ids } }, select: { id: true } });
    const ok = existing.map((a) => a.id);
    if (ok.length === 0) return { updated: 0 };
    const r = await db.asset.updateMany({ where: { id: { in: ok } }, data });
    const imp = this.ctx.impersonatedBy ?? null;
    for (const id of ok) {
      await writeAuditEntry(db, { assetId: id, action: 'BULK_UPDATED', performedById, detail: { patch }, impersonatedBy: imp }).catch(() => {});
    }
    this.events.emit('asset.bulk_updated', { ids: ok, patch }).catch(() => {});
    return { updated: r.count };
  }

  async bulkDelete(ids: string[], performedById: string) {
    const db = this.ctx.prisma();
    if (!ids?.length) throw new BadRequestException('No ids');
    if (ids.length > 500) throw new BadRequestException('Too many ids (max 500)');
    const imp = this.ctx.impersonatedBy ?? null;
    for (const id of ids) {
      await writeAuditEntry(db, { assetId: id, action: 'DELETED', performedById, detail: { bulk: true }, impersonatedBy: imp }).catch(() => {});
    }
    await db.auditLog.updateMany({ where: { assetId: { in: ids } }, data: { assetId: null } });
    const r = await db.asset.deleteMany({ where: { id: { in: ids } } });
    return { deleted: r.count };
  }

  private async nextAssetTag(): Promise<string> {
    const db = this.ctx.prisma();
    const count = await db.asset.count();
    return `AM-${String(count + 1).padStart(5, '0')}`;
  }

  private diff(a: any, b: any) {
    const changes: any = {};
    for (const k of Object.keys(b)) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k]) && !['updatedAt'].includes(k)) {
        changes[k] = { from: a[k], to: b[k] };
      }
    }
    return changes;
  }
}
