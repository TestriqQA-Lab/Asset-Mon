import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, Module,
  NotFoundException, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { IsArray, IsBoolean, IsDateString, IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { LifecycleService } from '../assets/lifecycle.service';
import { AssetsModule } from '../assets/assets.module';
import { NavPermissionsGuard } from '../tenant-settings/nav-permissions.guard';
import { RequireNav } from '../tenant-settings/require-nav.decorator';
import { NotificationsService } from '../notifications/notifications.module';

const URGENCIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
const STATUSES = ['PENDING', 'APPROVED', 'DECLINED', 'FULFILLED', 'CANCELLED'] as const;
const MODES = ['CATEGORY', 'SPECIFIC'] as const;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
@Injectable()
class AssetRequestsService {
  constructor(
    private readonly ctx: TenantContextService,
    private readonly lifecycle: LifecycleService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * List asset requests, scoped per role:
   * - EMPLOYEE: own requests only
   * - ASSET_MANAGER: own assigned queue by default, all if `showAll` is true
   * - ADMIN: all
   */
  async list(filter: {
    status?: string; categoryId?: string; escalated?: boolean;
    showAll?: boolean; viewerRole: string; viewerId: string;
  }) {
    const where: any = {};
    if (filter.status) where.status = filter.status;
    if (filter.categoryId) where.categoryId = filter.categoryId;
    if (filter.escalated !== undefined) where.escalatedToAdmin = filter.escalated;

    if (filter.viewerRole === 'EMPLOYEE') {
      where.requestedById = filter.viewerId;
    } else if (filter.viewerRole === 'ASSET_MANAGER' && !filter.showAll) {
      where.assignedToId = filter.viewerId;
    }
    // ADMIN: no extra scoping

    const rows = await this.ctx.prisma().assetRequest.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        requestedBy: {
          select: {
            id: true, firstName: true, lastName: true, email: true,
            department: { select: { name: true } },
          },
        },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        category: { select: { id: true, name: true } },
        fulfilledAsset: { select: { id: true, assetTag: true, name: true, status: true } },
        items: { select: { id: true, status: true } },
      },
    });

    // Compute daysOpen (ms → days, floored).
    const now = Date.now();
    const withAge = rows.map((r) => ({
      ...r,
      daysOpen: Math.floor((now - new Date(r.createdAt).getTime()) / 86_400_000),
    }));

    // Batch-fetch IN_STOCK counts per unique categoryId (avoids N+1).
    const categoryIds = [...new Set(rows.map((r) => r.categoryId).filter(Boolean))] as string[];
    let stockMap = new Map<string, number>();
    if (categoryIds.length > 0) {
      const stockCounts = await this.ctx.prisma().asset.groupBy({
        by: ['categoryId'],
        where: { categoryId: { in: categoryIds }, status: 'IN_STOCK' },
        _count: { _all: true },
      });
      stockMap = new Map(stockCounts.map((s: any) => [s.categoryId, s._count._all]));
    }

    return withAge.map((r) => ({
      ...r,
      categoryInStock: r.categoryId ? (stockMap.get(r.categoryId) ?? 0) : null,
    }));
  }

  async get(id: string, viewer: { userId: string; role: string }) {
    const r = await this.ctx.prisma().assetRequest.findUnique({
      where: { id },
      include: {
        requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        reviewedBy: { select: { id: true, firstName: true, lastName: true } },
        category: { select: { id: true, name: true } },
        fulfilledAsset: { select: { id: true, assetTag: true, name: true, status: true } },
        items: {
          orderBy: { createdAt: 'asc' },
          include: {
            asset: {
              select: {
                id: true, assetTag: true, name: true, status: true,
                assignments: {
                  where: { returnedAt: null },
                  take: 1,
                  orderBy: { checkedOutAt: 'desc' },
                  include: { user: { select: { id: true, firstName: true, lastName: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (!r) throw new NotFoundException('Asset request not found');
    // EMPLOYEE can only see own requests — return 404 to hide existence.
    if (viewer.role === 'EMPLOYEE' && r.requestedById !== viewer.userId) {
      throw new NotFoundException('Asset request not found');
    }

    // Enrich each specific-device line with LIVE availability, computed from the
    // asset's current status + open assignment (never stored → always accurate).
    // The holder NAME is shown to reviewers only (ADMIN/ASSET_MANAGER); the employee
    // sees "in use" via `available` but not who holds it (consistent with asset scoping).
    const canSeeHolder = viewer.role === 'ADMIN' || viewer.role === 'ASSET_MANAGER';
    const items = ((r as any).items ?? []).map((it: any) => {
      const open = it.asset?.assignments?.[0];
      const holder = open?.user;
      return {
        id: it.id,
        status: it.status,
        assetId: it.assetId,
        asset: it.asset
          ? { id: it.asset.id, assetTag: it.asset.assetTag, name: it.asset.name, status: it.asset.status }
          : null,
        available: it.asset?.status === 'IN_STOCK' && !open,
        heldBy: (canSeeHolder && holder) ? { id: holder.id, name: `${holder.firstName} ${holder.lastName}`.trim() } : null,
      };
    });

    return { ...r, items };
  }

  async create(
    data: {
      mode?: string; title?: string; categoryId?: string; reason?: string; urgency?: string;
      assetIds?: string[]; neededBy?: string; isTemporary?: boolean; returnBy?: string;
    },
    requestedById: string,
  ) {
    const db = this.ctx.prisma();
    const mode = data.mode === 'SPECIFIC' ? 'SPECIFIC' : 'CATEGORY';

    // Optional scheduling fields — apply to both modes.
    const neededBy = data.neededBy ? new Date(data.neededBy) : null;
    const isTemporary = !!data.isTemporary;
    const returnBy = isTemporary && data.returnBy ? new Date(data.returnBy) : null;

    let title: string;
    let categoryId: string | null = null;
    let assetIds: string[] = [];

    if (mode === 'SPECIFIC') {
      // De-dupe the picked device ids and validate they all exist in THIS tenant
      // (ctx.prisma() is already tenant-scoped). Availability is intentionally NOT
      // checked here — the manager sees live availability at review time and decides.
      assetIds = [...new Set((data.assetIds ?? []).filter(Boolean))];
      if (assetIds.length === 0) {
        throw new BadRequestException('Pick at least one device for a specific-device request');
      }
      const found = await db.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true } });
      if (found.length !== assetIds.length) {
        throw new BadRequestException('One or more selected devices no longer exist');
      }
      title = data.title?.trim() || `${assetIds.length} specific device${assetIds.length === 1 ? '' : 's'}`;
      // categoryId stays null — a specific pick can span categories.
    } else {
      // CATEGORY (general need): title required, category optional (unchanged from Phase 2).
      if (!data.title || !data.title.trim()) {
        throw new BadRequestException('A title is required');
      }
      title = data.title.trim();
      categoryId = data.categoryId || null;
    }

    const number = await this.nextNumber();
    // Round-robin: assign to the ASSET_MANAGER with the fewest open (PENDING) requests.
    const assignedToId = await this.pickManager();

    const request = await db.assetRequest.create({
      data: {
        number,
        mode: mode as any,
        title,
        categoryId,
        reason: data.reason || null,
        urgency: (data.urgency as any) || 'NORMAL',
        status: 'PENDING',
        neededBy,
        isTemporary,
        returnBy,
        requestedById,
        assignedToId,
        ...(assetIds.length > 0
          ? { items: { create: assetIds.map((assetId) => ({ assetId })) } }
          : {}),
      },
      include: {
        requestedBy: { select: { id: true, firstName: true, lastName: true } },
        category: { select: { id: true, name: true } },
        items: { select: { id: true, assetId: true, status: true } },
      },
    });

    // Notify the assigned manager (or all admins as fallback).
    if (assignedToId) {
      this.notifications.push({
        userId: assignedToId,
        kind: 'asset_request.created',
        title: `New asset request ${request.number}`,
        body: `${request.requestedBy.firstName} ${request.requestedBy.lastName}: ${request.title}`,
        href: `/dashboard/asset-requests/${request.id}`,
      }).catch(() => {});
    } else {
      // No managers — notify all admins as fallback.
      const admins = await db.user.findMany({ where: { role: 'ADMIN', active: true }, select: { id: true } });
      for (const admin of admins) {
        this.notifications.push({
          userId: admin.id,
          kind: 'asset_request.created',
          title: `New asset request ${request.number} (no managers available)`,
          body: `${request.requestedBy.firstName} ${request.requestedBy.lastName}: ${request.title}`,
          href: `/dashboard/asset-requests/${request.id}`,
        }).catch(() => {});
      }
    }

    return request;
  }

  async cancel(id: string, userId: string) {
    const db = this.ctx.prisma();
    const r = await db.assetRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (r.requestedById !== userId) {
      throw new ForbiddenException('You can only cancel your own requests');
    }
    if (r.status !== 'PENDING') {
      throw new BadRequestException(`Cannot cancel from status ${r.status}`);
    }
    const guard = await db.assetRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    if (guard.count === 0) throw new BadRequestException('Request is no longer pending.');
    const updated = await db.assetRequest.findUnique({ where: { id } });

    // Notify the assigned manager that it was cancelled.
    if (r.assignedToId) {
      this.notifications.push({
        userId: r.assignedToId,
        kind: 'system',
        title: `Asset request ${r.number} cancelled`,
        body: 'The employee cancelled their request.',
        href: `/dashboard/asset-requests/${r.id}`,
      }).catch(() => {});
    }

    return updated;
  }

  async reassign(id: string, newAssigneeId: string, performerId: string) {
    const db = this.ctx.prisma();
    const r = await db.assetRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (r.status !== 'PENDING') {
      throw new BadRequestException('Can only reassign PENDING requests');
    }
    // Validate the new assignee is an active manager or admin.
    const target = await db.user.findUnique({ where: { id: newAssigneeId } });
    if (!target || !target.active || !['ADMIN', 'ASSET_MANAGER'].includes(target.role)) {
      throw new BadRequestException('Target must be an active admin or asset manager');
    }
    const guard = await db.assetRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { assignedToId: newAssigneeId },
    });
    if (guard.count === 0) throw new BadRequestException('Request is no longer pending.');
    const updated = await db.assetRequest.findUnique({ where: { id } });

    // Notify the new assignee.
    this.notifications.push({
      userId: newAssigneeId,
      kind: 'asset_request.created',
      title: `Asset request ${r.number} assigned to you`,
      body: r.title,
      href: `/dashboard/asset-requests/${r.id}`,
    }).catch(() => {});

    return updated;
  }

  async approve(id: string, fulfilledAssetId: string, reviewerId: string) {
    const db = this.ctx.prisma();
    const r = await db.assetRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (r.status !== 'PENDING') {
      throw new BadRequestException(`Cannot approve from status ${r.status}`);
    }
    // Validate the chosen asset exists and is available.
    const asset = await db.asset.findUnique({ where: { id: fulfilledAssetId }, select: { id: true, status: true, assetTag: true, name: true } });
    if (!asset) throw new BadRequestException('Asset not found');
    if (!['IN_STOCK', 'ASSIGNED'].includes(asset.status)) {
      throw new BadRequestException(`Asset is ${asset.status} — pick an available asset`);
    }

    const guard = await db.assetRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'APPROVED',
        fulfilledAssetId,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
      },
    });
    if (guard.count === 0) throw new BadRequestException('Request was already handled by someone else.');
    const updated = await db.assetRequest.findUnique({ where: { id } });

    // Notify the requesting employee.
    this.notifications.push({
      userId: r.requestedById,
      kind: 'asset_request.approved',
      title: `Your request ${r.number} was approved`,
      body: `Asset ${asset.assetTag} (${asset.name}) has been allocated.`,
      href: `/dashboard/asset-requests/${r.id}`,
    }).catch(() => {});

    return updated;
  }

  async decline(id: string, reason: string, reviewerId: string) {
    const db = this.ctx.prisma();
    const r = await db.assetRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (r.status !== 'PENDING') {
      throw new BadRequestException(`Cannot decline from status ${r.status}`);
    }
    const guard = await db.assetRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'DECLINED',
        declineReason: reason,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
      },
    });
    if (guard.count === 0) throw new BadRequestException('Request was already handled by someone else.');
    const updated = await db.assetRequest.findUnique({ where: { id } });

    // Notify the requesting employee.
    this.notifications.push({
      userId: r.requestedById,
      kind: 'asset_request.declined',
      title: `Your request ${r.number} was declined`,
      body: reason,
      href: `/dashboard/asset-requests/${r.id}`,
    }).catch(() => {});

    return updated;
  }

  async escalate(id: string, performerId: string, note?: string) {
    const db = this.ctx.prisma();
    const r = await db.assetRequest.findUnique({
      where: { id },
      include: { requestedBy: { select: { firstName: true, lastName: true } } },
    });
    if (!r) throw new NotFoundException();
    if (r.status !== 'PENDING') {
      throw new BadRequestException(`Cannot escalate from status ${r.status}`);
    }
    const guard = await db.assetRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { escalatedToAdmin: true, escalationNote: note || null },
    });
    if (guard.count === 0) throw new BadRequestException('Request is no longer pending.');
    const updated = await db.assetRequest.findUnique({ where: { id } });

    // Notify all admins.
    const admins = await db.user.findMany({ where: { role: 'ADMIN', active: true }, select: { id: true } });
    for (const admin of admins) {
      this.notifications.push({
        userId: admin.id,
        kind: 'asset_request.escalated',
        title: `Escalated: ${r.number} — ${r.title}`,
        body: note || `Escalated by manager. Requester: ${r.requestedBy.firstName} ${r.requestedBy.lastName}`,
        href: `/dashboard/asset-requests/${r.id}`,
      }).catch(() => {});
    }

    return updated;
  }

  async fulfil(id: string, performerId: string) {
    const db = this.ctx.prisma();
    const r = await db.assetRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (r.status !== 'APPROVED') {
      throw new BadRequestException(`Cannot fulfil from status ${r.status} — approve first`);
    }
    if (!r.fulfilledAssetId) {
      throw new BadRequestException('No asset allocated — approve with an asset first');
    }

    // Use the existing lifecycle checkout to assign the asset to the employee.
    await this.lifecycle.checkout(r.fulfilledAssetId, r.requestedById, null, performerId);

    const guard = await db.assetRequest.updateMany({
      where: { id, status: 'APPROVED' },
      data: { status: 'FULFILLED', fulfilledAt: new Date() },
    });
    if (guard.count === 0) throw new BadRequestException('Request was already fulfilled or is no longer approved.');
    const updated = await db.assetRequest.findUnique({ where: { id } });

    // Notify the requesting employee.
    this.notifications.push({
      userId: r.requestedById,
      kind: 'asset_request.fulfilled',
      title: `Your request ${r.number} has been fulfilled`,
      body: 'Your asset is ready — check your assignments.',
      href: `/dashboard/asset-requests/${r.id}`,
    }).catch(() => {});

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Round-robin assignment: pick the ASSET_MANAGER with the fewest open requests.
  // ---------------------------------------------------------------------------
  private async pickManager(): Promise<string | null> {
    const db = this.ctx.prisma();
    const managers = await db.user.findMany({
      where: { role: 'ASSET_MANAGER', active: true },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'asc' }, // tie-break: longest-tenured first
    });
    if (managers.length === 0) return null;
    if (managers.length === 1) return managers[0].id;

    // Count open requests per manager in a single query.
    const counts = await db.assetRequest.groupBy({
      by: ['assignedToId'],
      where: {
        assignedToId: { in: managers.map((m) => m.id) },
        status: 'PENDING',
      },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c: any) => [c.assignedToId, c._count._all]));

    // Pick the manager with the fewest pending requests (tie-break already
    // handled by the sorted manager list — earliest createdAt comes first).
    let best = managers[0];
    let bestCount = countMap.get(best.id) || 0;
    for (let i = 1; i < managers.length; i++) {
      const c = countMap.get(managers[i].id) || 0;
      if (c < bestCount) {
        best = managers[i];
        bestCount = c;
      }
    }
    return best.id;
  }

  private async nextNumber(): Promise<string> {
    const count = await this.ctx.prisma().assetRequest.count();
    return `AR-${String(count + 1).padStart(5, '0')}`;
  }

  // ---------------------------------------------------------------------------
  // Phase 3A: stats summary (role-scoped)
  // ---------------------------------------------------------------------------
  async stats(viewerRole: string, viewerId: string) {
    const db = this.ctx.prisma();
    const scope: any = {};
    if (viewerRole === 'EMPLOYEE') scope.requestedById = viewerId;
    else if (viewerRole === 'ASSET_MANAGER') scope.assignedToId = viewerId;

    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const [pending, urgent, escalated, approved, closedThisWeek, total] = await Promise.all([
      db.assetRequest.count({ where: { ...scope, status: 'PENDING' } }),
      db.assetRequest.count({ where: { ...scope, status: 'PENDING', urgency: 'URGENT' } }),
      db.assetRequest.count({ where: { ...scope, escalatedToAdmin: true, status: 'PENDING' } }),
      db.assetRequest.count({ where: { ...scope, status: 'APPROVED' } }),
      db.assetRequest.count({
        where: {
          ...scope,
          status: { in: ['FULFILLED', 'DECLINED', 'CANCELLED'] },
          updatedAt: { gte: startOfWeek },
        },
      }),
      db.assetRequest.count({ where: scope }),
    ]);

    return { pending, urgent, escalated, approved, closedThisWeek, total };
  }

  // ---------------------------------------------------------------------------
  // Phase 3A: demand insights — top requested categories this month
  // ---------------------------------------------------------------------------
  async demand() {
    const db = this.ctx.prisma();
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const grouped = await db.assetRequest.groupBy({
      by: ['categoryId'],
      where: {
        categoryId: { not: null },
        createdAt: { gte: startOfMonth },
      },
      _count: { _all: true },
      orderBy: { _count: { categoryId: 'desc' } },
      take: 8,
    });

    if (grouped.length === 0) return [];

    const catIds = grouped.map((g: any) => g.categoryId as string);
    const cats = await db.category.findMany({
      where: { id: { in: catIds } },
      select: { id: true, name: true },
    });
    const catMap = new Map(cats.map((c) => [c.id, c.name]));

    return grouped.map((g: any) => ({
      categoryId: g.categoryId,
      categoryName: catMap.get(g.categoryId) ?? 'Unknown',
      count: g._count._all,
    }));
  }
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------
class CreateAssetRequestDto {
  @IsOptional() @IsEnum(MODES) mode?: typeof MODES[number];
  @IsOptional() @IsString() @MinLength(1) title?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsEnum(URGENCIES) urgency?: typeof URGENCIES[number];
  // v2: specific-device mode + optional scheduling fields
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) assetIds?: string[];
  @IsOptional() @IsDateString() neededBy?: string;
  @IsOptional() @IsBoolean() isTemporary?: boolean;
  @IsOptional() @IsDateString() returnBy?: string;
}

class ApproveDto {
  @IsUUID() assetId: string;
}

class DeclineDto {
  @IsString() @MinLength(1) reason: string;
}

class EscalateDto {
  @IsOptional() @IsString() note?: string;
}

class ReassignDto {
  @IsUUID() assignedToId: string;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------
@ApiTags('asset-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, NavPermissionsGuard)
@RequireNav('asset-requests')
@Controller('asset-requests')
class AssetRequestsController {
  constructor(private readonly svc: AssetRequestsService) {}

  // Phase 3A: stats — must come before :id to avoid route conflict
  @Get('stats')
  stats(@CurrentUser('sub') uid: string, @CurrentUser('role') role: string) {
    return this.svc.stats(role, uid);
  }

  // Phase 3A: demand insights — manager/admin only
  @Get('demand')
  @Roles('ADMIN', 'ASSET_MANAGER')
  demand() {
    return this.svc.demand();
  }

  @Get()
  list(
    @CurrentUser('sub') uid: string,
    @CurrentUser('role') role: string,
    @Query('status') status?: string,
    @Query('categoryId') categoryId?: string,
    @Query('escalated') escalated?: string,
    @Query('all') showAll?: string,
  ) {
    return this.svc.list({
      status,
      categoryId,
      escalated: escalated === 'true' ? true : escalated === 'false' ? false : undefined,
      showAll: showAll === 'true',
      viewerRole: role,
      viewerId: uid,
    });
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser('sub') uid: string, @CurrentUser('role') role: string) {
    return this.svc.get(id, { userId: uid, role });
  }

  @Post()
  @Roles('ADMIN', 'ASSET_MANAGER', 'EMPLOYEE')
  create(@Body() dto: CreateAssetRequestDto, @CurrentUser('sub') uid: string) {
    return this.svc.create(dto, uid);
  }

  @Post(':id/cancel')
  @Roles('ADMIN', 'ASSET_MANAGER', 'EMPLOYEE')
  cancel(@Param('id') id: string, @CurrentUser('sub') uid: string) {
    return this.svc.cancel(id, uid);
  }

  @Patch(':id')
  @Roles('ADMIN', 'ASSET_MANAGER')
  reassign(@Param('id') id: string, @Body() dto: ReassignDto, @CurrentUser('sub') uid: string) {
    return this.svc.reassign(id, dto.assignedToId, uid);
  }

  @Post(':id/approve')
  @Roles('ADMIN', 'ASSET_MANAGER')
  approve(@Param('id') id: string, @Body() dto: ApproveDto, @CurrentUser('sub') uid: string) {
    return this.svc.approve(id, dto.assetId, uid);
  }

  @Post(':id/decline')
  @Roles('ADMIN', 'ASSET_MANAGER')
  decline(@Param('id') id: string, @Body() dto: DeclineDto, @CurrentUser('sub') uid: string) {
    return this.svc.decline(id, dto.reason, uid);
  }

  @Post(':id/escalate')
  @Roles('ASSET_MANAGER')
  escalate(@Param('id') id: string, @Body() dto: EscalateDto, @CurrentUser('sub') uid: string) {
    return this.svc.escalate(id, uid, dto.note);
  }

  @Post(':id/fulfil')
  @Roles('ADMIN', 'ASSET_MANAGER')
  fulfil(@Param('id') id: string, @CurrentUser('sub') uid: string) {
    return this.svc.fulfil(id, uid);
  }
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------
@Module({
  imports: [AssetsModule], // for LifecycleService
  controllers: [AssetRequestsController],
  providers: [AssetRequestsService],
})
export class AssetRequestsModule {}
