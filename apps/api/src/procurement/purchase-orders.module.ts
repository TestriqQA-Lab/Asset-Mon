import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException,
  Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { AssetsService } from '../assets/assets.service';
import { AssetsModule } from '../assets/assets.module';
import { ModuleGuard } from '../tenant-settings/module.guard';
import { RequireModule } from '../tenant-settings/require-module.decorator';
import { NavPermissionsGuard } from '../tenant-settings/nav-permissions.guard';
import { RequireNav } from '../tenant-settings/require-nav.decorator';

@Injectable()
class PurchaseOrdersService {
  constructor(
    private readonly ctx: TenantContextService,
    private readonly assets: AssetsService,
  ) {}

  list(filter: { status?: string }) {
    const where: any = {};
    if (filter.status) where.status = filter.status;
    return this.ctx.prisma().purchaseOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        vendor: { select: { id: true, name: true } },
        pr: { select: { id: true, number: true, title: true } },
        items: true,
      },
    });
  }

  get(id: string) {
    return this.ctx.prisma().purchaseOrder.findUnique({
      where: { id },
      include: {
        vendor: true,
        pr: { select: { id: true, number: true, title: true } },
        items: { include: { category: { select: { id: true, name: true } } } },
        assets: { select: { id: true, assetTag: true, name: true, status: true } },
      },
    });
  }

  async createFromPr(prId: string) {
    const db = this.ctx.prisma();
    const pr = await db.purchaseRequest.findUnique({ where: { id: prId }, include: { items: true } });
    if (!pr) throw new NotFoundException('Request not found');
    if (pr.status !== 'APPROVED') throw new BadRequestException('Request must be APPROVED');
    const poNumber = await this.nextPoNumber();
    const po = await db.purchaseOrder.create({
      data: {
        poNumber,
        prId,
        status: 'DRAFT',
        // Carry the requester's notes (and the PR's own number) into the PO so the
        // downstream buyer keeps the original justification.
        notes: pr.notes ? `[from ${pr.number}] ${pr.notes}` : `[from ${pr.number}]`,
        items: {
          create: pr.items.map((i: any) => ({
            categoryId: i.categoryId,
            description: i.description,
            quantity: i.quantity,
            unitCost: i.unitPriceEstimate || 0,
          })),
        },
        totalCost: pr.totalEstimate,
      },
      include: { items: true },
    });
    await db.purchaseRequest.update({ where: { id: prId }, data: { status: 'ORDERED' } });
    return po;
  }

  async createBlank(data: any) {
    const db = this.ctx.prisma();
    const poNumber = await this.nextPoNumber();
    const items = (data.items || []) as any[];
    const total = items.reduce((s, i) => s + (i.unitCost || 0) * (i.quantity || 0), 0);
    return db.purchaseOrder.create({
      data: {
        poNumber,
        vendorId: data.vendorId || null,
        status: 'DRAFT',
        totalCost: total || null,
        notes: data.notes || null,
        items: { create: items.map((i: any) => ({
          categoryId: i.categoryId || null,
          description: i.description,
          quantity: i.quantity,
          unitCost: i.unitCost || 0,
        })) },
      },
      include: { items: true },
    });
  }

  async update(id: string, data: any) {
    const db = this.ctx.prisma();
    const po = await db.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw new NotFoundException();
    if (po.status === 'RECEIVED' || po.status === 'CANCELLED') {
      throw new BadRequestException(`Cannot edit ${po.status} order`);
    }
    const patch: any = {};
    if (data.vendorId !== undefined) patch.vendorId = data.vendorId || null;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.items) {
      await db.purchaseOrderItem.deleteMany({ where: { poId: id } });
      patch.items = { create: data.items.map((i: any) => ({
        categoryId: i.categoryId || null,
        description: i.description,
        quantity: i.quantity,
        unitCost: i.unitCost || 0,
      })) };
      patch.totalCost = data.items.reduce((s: number, i: any) => s + (i.unitCost || 0) * (i.quantity || 0), 0);
    }
    return db.purchaseOrder.update({ where: { id }, data: patch, include: { items: true } });
  }

  async send(id: string) {
    const db = this.ctx.prisma();
    const po = await db.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!po) throw new NotFoundException();
    if (po.status !== 'DRAFT') throw new BadRequestException(`Cannot send from ${po.status}`);
    if (po.items.length === 0) throw new BadRequestException('PO has no items');
    return db.purchaseOrder.update({ where: { id }, data: { status: 'SENT', orderedAt: new Date() } });
  }

  async receive(id: string, namePrefix: string | undefined, performedById: string) {
    const db = this.ctx.prisma();
    const po = await db.purchaseOrder.findUnique({
      where: { id },
      include: { items: { include: { category: true } } },
    });
    if (!po) throw new NotFoundException();
    if (!['SENT', 'PARTIAL'].includes(po.status)) throw new BadRequestException(`Cannot receive from ${po.status}`);

    const missing = po.items.filter((i: any) => i.quantity - i.receivedQty > 0 && !i.categoryId);
    if (missing.length > 0) {
      throw new BadRequestException(`Items missing categories: ${missing.map((m: any) => m.description).join(', ')}`);
    }

    // Single up-front quota check covering everything we're about to insert so
    // we never half-receive a PO when the plan limit kicks in mid-loop.
    const totalToCreate = po.items.reduce((s: number, i: any) => s + Math.max(0, i.quantity - i.receivedQty), 0);
    await this.assets.assertCanAddAssets(totalToCreate);

    // Per-item idempotency keys keep replays from double-receiving on transient errors.
    const createdAssets: string[] = [];
    for (const item of po.items) {
      const toCreate = item.quantity - item.receivedQty;
      if (toCreate <= 0) continue;
      for (let i = 0; i < toCreate; i++) {
        const idemKey = `po:${id}:item:${item.id}:${item.receivedQty + i + 1}`;
        const seen = await db.idempotencyKey.findUnique({
          where: { scope_key: { scope: 'po-receive', key: idemKey } },
        }).catch(() => null);
        if (seen) continue;

        const a = await this.assets.create(
          {
            name: namePrefix ? `${namePrefix} ${createdAssets.length + 1}` : item.description,
            categoryId: item.categoryId,
            purchaseCost: Number(item.unitCost),
            purchaseDate: new Date().toISOString(),
            depreciationStart: new Date().toISOString(),
          },
          performedById,
          { skipBillingCheck: true },
        );
        await db.asset.update({ where: { id: a.id }, data: { purchaseOrderId: id } });
        await db.idempotencyKey.create({ data: { scope: 'po-receive', key: idemKey } }).catch(() => {});
        // Update receivedQty after each successful item so a crash mid-loop
        // leaves the PO in a consistent, replayable state (PARTIAL, not lost).
        await db.purchaseOrderItem.update({
          where: { id: item.id },
          data: { receivedQty: { increment: 1 } },
        });
        createdAssets.push(a.id);
      }
    }

    // If everything's received, flip to RECEIVED; otherwise PARTIAL so the user can retry.
    const refreshed = await db.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    const allReceived = refreshed!.items.every((i: any) => i.receivedQty >= i.quantity);
    await db.purchaseOrder.update({
      where: { id },
      data: { status: allReceived ? 'RECEIVED' : 'PARTIAL', receivedAt: allReceived ? new Date() : po.receivedAt },
    });
    return { received: createdAssets.length, assetIds: createdAssets };
  }

  async cancel(id: string) {
    const db = this.ctx.prisma();
    const po = await db.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw new NotFoundException();
    if (po.status === 'RECEIVED') throw new BadRequestException('Cannot cancel a received PO');
    return db.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  remove(id: string) {
    return this.ctx.prisma().purchaseOrder.delete({ where: { id } });
  }

  private async nextPoNumber() {
    const c = await this.ctx.prisma().purchaseOrder.count();
    return `PO-${String(c + 1).padStart(5, '0')}`;
  }
}

class POItemDto {
  @IsOptional() @IsString() categoryId?: string;
  @IsString() @MinLength(1) description: string;
  @IsInt() @Min(1) quantity: number;
  @IsNumber() unitCost: number;
}
class CreatePoDto {
  @IsOptional() @IsString() vendorId?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => POItemDto) items: POItemDto[];
}
class UpdatePoDto {
  @IsOptional() @IsString() vendorId?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => POItemDto) items?: POItemDto[];
}

@ApiTags('purchase-orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ModuleGuard, RolesGuard, NavPermissionsGuard)
@RequireModule('procurement')
@RequireNav('purchase-orders')
@Controller('purchase-orders')
class PurchaseOrdersController {
  constructor(private readonly svc: PurchaseOrdersService) {}

  @Get() list(@Query('status') status?: string) { return this.svc.list({ status }); }

  @Get(':id') get(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  @Roles('ADMIN', 'ASSET_MANAGER')
  create(@Body() dto: CreatePoDto) { return this.svc.createBlank(dto); }

  @Post('from-pr/:prId')
  @Roles('ADMIN', 'ASSET_MANAGER')
  fromPr(@Param('prId') prId: string) { return this.svc.createFromPr(prId); }

  @Patch(':id')
  @Roles('ADMIN', 'ASSET_MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdatePoDto) { return this.svc.update(id, dto); }

  @Post(':id/send')
  @Roles('ADMIN', 'ASSET_MANAGER')
  send(@Param('id') id: string) { return this.svc.send(id); }

  @Post(':id/receive')
  @Roles('ADMIN', 'ASSET_MANAGER')
  receive(@Param('id') id: string, @Body() body: { namePrefix?: string }, @CurrentUser('sub') uid: string) {
    return this.svc.receive(id, body?.namePrefix, uid);
  }

  @Post(':id/cancel')
  @Roles('ADMIN', 'ASSET_MANAGER')
  cancel(@Param('id') id: string) { return this.svc.cancel(id); }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}

@Module({
  imports: [AssetsModule],
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
