import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, Module,
  NotFoundException, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { ModuleGuard } from '../tenant-settings/module.guard';
import { RequireModule } from '../tenant-settings/require-module.decorator';
import { NavPermissionsGuard } from '../tenant-settings/nav-permissions.guard';
import { RequireNav } from '../tenant-settings/require-nav.decorator';
import { NotificationsService } from '../notifications/notifications.module';

const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'CANCELLED'] as const;

@Injectable()
class PurchaseRequestsService {
  constructor(
    private readonly ctx: TenantContextService,
    private readonly notifications: NotificationsService,
  ) {}

  list(filter: { status?: string; requestedById?: string }) {
    const where: any = {};
    if (filter.status) where.status = filter.status;
    if (filter.requestedById) where.requestedById = filter.requestedById;
    return this.ctx.prisma().purchaseRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        requestedBy: { select: { id: true, firstName: true, lastName: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
        department: { select: { id: true, name: true } },
        items: true,
      },
    });
  }

  get(id: string) {
    return this.ctx.prisma().purchaseRequest.findUnique({
      where: { id },
      include: {
        requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        department: true,
        items: { include: { category: { select: { id: true, name: true } } } },
        purchaseOrders: { select: { id: true, poNumber: true, status: true } },
      },
    });
  }

  async create(data: any, requestedById: string) {
    const db = this.ctx.prisma();
    const number = await this.nextNumber();
    const items = (data.items || []) as Array<{ description: string; quantity: number; unitPriceEstimate?: number; categoryId?: string }>;
    const total = items.reduce((s, i) => s + (i.unitPriceEstimate || 0) * (i.quantity || 0), 0);
    return db.purchaseRequest.create({
      data: {
        number,
        title: data.title,
        justification: data.justification || null,
        status: 'DRAFT',
        requestedById,
        departmentId: data.departmentId || null,
        totalEstimate: total || null,
        notes: data.notes || null,
        items: { create: items.map((i) => ({ ...i, unitPriceEstimate: i.unitPriceEstimate ?? null })) },
      },
      include: { items: true },
    });
  }

  private canMutate(pr: any, userId: string, role: string) {
    return pr.requestedById === userId || ['ADMIN', 'ASSET_MANAGER'].includes(role);
  }

  async update(id: string, data: any, performedById: string, role: string) {
    const db = this.ctx.prisma();
    const pr = await db.purchaseRequest.findUnique({ where: { id }, include: { items: true } });
    if (!pr) throw new NotFoundException();
    if (!this.canMutate(pr, performedById, role)) {
      throw new ForbiddenException('You can only edit your own purchase requests');
    }
    if (!['DRAFT'].includes(pr.status) && (data.items || data.title || data.justification)) {
      throw new BadRequestException('Cannot edit items/title once submitted');
    }
    const patch: any = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.justification !== undefined) patch.justification = data.justification;
    if (data.departmentId !== undefined) patch.departmentId = data.departmentId || null;
    if (data.notes !== undefined) patch.notes = data.notes;

    if (data.items) {
      await db.purchaseRequestItem.deleteMany({ where: { prId: id } });
      patch.items = { create: data.items.map((i: any) => ({ ...i, unitPriceEstimate: i.unitPriceEstimate ?? null })) };
      patch.totalEstimate = data.items.reduce((s: number, i: any) => s + (i.unitPriceEstimate || 0) * (i.quantity || 0), 0) || null;
    }

    return db.purchaseRequest.update({ where: { id }, data: patch, include: { items: true } });
  }

  async submit(id: string, userId: string, role: string) {
    const db = this.ctx.prisma();
    const pr = await db.purchaseRequest.findUnique({ where: { id }, include: { items: true } });
    if (!pr) throw new NotFoundException();
    if (!this.canMutate(pr, userId, role)) {
      throw new ForbiddenException('You can only submit your own purchase requests');
    }
    if (pr.status !== 'DRAFT') throw new BadRequestException(`Cannot submit from status ${pr.status}`);
    if (pr.items.length === 0) throw new BadRequestException('Add at least one item');
    const updated = await db.purchaseRequest.update({ where: { id }, data: { status: 'SUBMITTED' } });

    // Phase 2 RBAC: notify Asset Managers when a PR is submitted.
    const managers = await db.user.findMany({
      where: { role: 'ASSET_MANAGER', active: true },
      select: { id: true },
    });
    for (const mgr of managers) {
      this.notifications.push({
        userId: mgr.id,
        kind: 'purchase_request.submitted',
        title: `Purchase request ${pr.number} submitted`,
        body: pr.title,
        href: `/dashboard/purchase-requests/${pr.id}`,
      }).catch(() => {});
    }

    return updated;
  }

  async approve(id: string, approve: boolean, approverId: string, role: string) {
    if (!['ADMIN', 'ASSET_MANAGER'].includes(role)) throw new ForbiddenException();
    const db = this.ctx.prisma();
    const pr = await db.purchaseRequest.findUnique({ where: { id } });
    if (!pr) throw new NotFoundException();
    if (pr.status !== 'SUBMITTED') throw new BadRequestException(`Cannot approve/reject from ${pr.status}`);
    const updated = await db.purchaseRequest.update({
      where: { id },
      data: { status: approve ? 'APPROVED' : 'REJECTED', approvedById: approverId, approvedAt: new Date() },
    });

    // Phase 2 RBAC: notify the requester about the decision.
    this.notifications.push({
      userId: pr.requestedById,
      kind: approve ? 'purchase_request.approved' : 'purchase_request.rejected',
      title: `Purchase request ${pr.number} ${approve ? 'approved' : 'rejected'}`,
      body: pr.title,
      href: `/dashboard/purchase-requests/${pr.id}`,
    }).catch(() => {});

    return updated;
  }

  async cancel(id: string, userId: string, role: string) {
    const db = this.ctx.prisma();
    const pr = await db.purchaseRequest.findUnique({ where: { id } });
    if (!pr) throw new NotFoundException();
    if (!this.canMutate(pr, userId, role)) {
      throw new ForbiddenException('You can only cancel your own purchase requests');
    }
    if (['ORDERED', 'CANCELLED'].includes(pr.status)) throw new BadRequestException(`Cannot cancel from ${pr.status}`);
    return db.purchaseRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  remove(id: string) {
    return this.ctx.prisma().purchaseRequest.delete({ where: { id } });
  }

  private async nextNumber() {
    const c = await this.ctx.prisma().purchaseRequest.count();
    return `PR-${String(c + 1).padStart(5, '0')}`;
  }
}

class PRItemDto {
  @IsOptional() @IsString() categoryId?: string;
  @IsString() @MinLength(1) description: string;
  @IsInt() @Min(1) quantity: number;
  @IsOptional() @IsNumber() unitPriceEstimate?: number;
}
class CreatePRDto {
  @IsString() @MinLength(1) title: string;
  @IsOptional() @IsString() justification?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PRItemDto) items: PRItemDto[];
}
class UpdatePRDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() justification?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PRItemDto) items?: PRItemDto[];
}
class StatusDto {
  @IsEnum(STATUSES) status: typeof STATUSES[number];
}

@ApiTags('purchase-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ModuleGuard, RolesGuard, NavPermissionsGuard)
@RequireModule('procurement')
@RequireNav('purchase-requests')
@Controller('purchase-requests')
class PurchaseRequestsController {
  constructor(private readonly svc: PurchaseRequestsService) {}

  @Get()
  list(@Query('status') status?: string, @Query('requestedById') rid?: string) {
    return this.svc.list({ status, requestedById: rid });
  }

  @Get(':id')
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  create(@Body() dto: CreatePRDto, @CurrentUser('sub') uid: string) {
    return this.svc.create(dto, uid);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePRDto, @CurrentUser('sub') uid: string, @CurrentUser('role') role: string) {
    return this.svc.update(id, dto, uid, role);
  }

  @Post(':id/submit')
  submit(@Param('id') id: string, @CurrentUser('sub') uid: string, @CurrentUser('role') role: string) {
    return this.svc.submit(id, uid, role);
  }

  @Post(':id/approve')
  @Roles('ADMIN', 'ASSET_MANAGER')
  approve(@Param('id') id: string, @CurrentUser('sub') uid: string, @CurrentUser('role') role: string) {
    return this.svc.approve(id, true, uid, role);
  }

  @Post(':id/reject')
  @Roles('ADMIN', 'ASSET_MANAGER')
  reject(@Param('id') id: string, @CurrentUser('sub') uid: string, @CurrentUser('role') role: string) {
    return this.svc.approve(id, false, uid, role);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser('sub') uid: string, @CurrentUser('role') role: string) {
    return this.svc.cancel(id, uid, role);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}

@Module({ controllers: [PurchaseRequestsController], providers: [PurchaseRequestsService] })
export class PurchaseRequestsModule {}
