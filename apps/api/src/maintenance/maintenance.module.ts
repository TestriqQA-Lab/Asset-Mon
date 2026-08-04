import { Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsISO8601, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { assertTenantRefs } from '../tenancy/assert-tenant-refs';
import { ModuleGuard } from '../tenant-settings/module.guard';
import { RequireModule } from '../tenant-settings/require-module.decorator';
import { NavPermissionsGuard } from '../tenant-settings/nav-permissions.guard';
import { RequireNav } from '../tenant-settings/require-nav.decorator';
import { writeAuditEntry } from '../common/audit-hash';

@Injectable()
class MaintenanceService {
  constructor(private readonly ctx: TenantContextService) {}

  list(opts: { assetId?: string; due?: boolean }) {
    const where: any = {};
    if (opts.assetId) where.assetId = opts.assetId;
    if (opts.due) where.active = true, (where.nextDueAt = { lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
    return this.ctx.prisma().maintenanceSchedule.findMany({
      where,
      orderBy: { nextDueAt: 'asc' },
      include: { asset: { select: { id: true, assetTag: true, name: true } } },
    });
  }

  async create(data: { assetId: string; title: string; description?: string; intervalDays: number; nextDueAt: string }, performedById: string) {
    const db = this.ctx.prisma();
    await assertTenantRefs(db, { asset: data.assetId });
    const m = await db.maintenanceSchedule.create({
      data: {
        tenantId: this.ctx.tenantId!,
        assetId: data.assetId,
        title: data.title,
        description: data.description,
        intervalDays: data.intervalDays,
        nextDueAt: new Date(data.nextDueAt),
      },
    });
    await writeAuditEntry(db, { tenantId: this.ctx.tenantId!, assetId: data.assetId, action: 'MAINT_SCHEDULED', performedById, detail: { scheduleId: m.id, title: data.title } });
    return m;
  }

  update(id: string, data: any) {
    const patch: any = { ...data };
    if (data.nextDueAt) patch.nextDueAt = new Date(data.nextDueAt);
    return this.ctx.prisma().maintenanceSchedule.update({ where: { id }, data: patch });
  }

  remove(id: string) {
    return this.ctx.prisma().maintenanceSchedule.delete({ where: { id } });
  }

  async markDone(id: string, performedById: string) {
    const db = this.ctx.prisma();
    const s = await db.maintenanceSchedule.findUnique({ where: { id } });
    if (!s) throw new Error('Not found');
    const next = new Date(Date.now() + s.intervalDays * 24 * 60 * 60 * 1000);
    const updated = await db.maintenanceSchedule.update({
      where: { id },
      data: { lastRunAt: new Date(), nextDueAt: next },
    });
    await writeAuditEntry(db, { tenantId: this.ctx.tenantId!, assetId: s.assetId, action: 'MAINT_PERFORMED', performedById, detail: { scheduleId: id, title: s.title } });
    return updated;
  }
}

class CreateScheduleDto {
  @IsString() assetId: string;
  @IsString() @MinLength(1) title: string;
  @IsOptional() @IsString() description?: string;
  @IsInt() @Min(1) intervalDays: number;
  @IsISO8601() nextDueAt: string;
}
class UpdateScheduleDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(1) intervalDays?: number;
  @IsOptional() @IsISO8601() nextDueAt?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

@ApiTags('maintenance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ModuleGuard, RolesGuard, NavPermissionsGuard)
@RequireModule('maintenance')
@RequireNav('maintenance')
@Controller('maintenance')
class MaintenanceController {
  constructor(private readonly svc: MaintenanceService) {}

  // Maintenance list / due-soon view is operational data; lock to manager+.
  // EMPLOYEE has no nav for maintenance and shouldn't be able to enumerate
  // upcoming-maintenance windows for the workspace.
  @Get()
  @Roles('ADMIN', 'ASSET_MANAGER')
  list(@Query('assetId') assetId?: string, @Query('due') due?: string) {
    return this.svc.list({ assetId, due: due === 'true' });
  }

  @Post()
  @Roles('ADMIN', 'ASSET_MANAGER')
  create(@Body() dto: CreateScheduleDto, @CurrentUser('sub') uid: string) {
    return this.svc.create(dto, uid);
  }

  @Patch(':id')
  @Roles('ADMIN', 'ASSET_MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateScheduleDto) {
    return this.svc.update(id, dto);
  }

  @Post(':id/done')
  @Roles('ADMIN', 'ASSET_MANAGER')
  done(@Param('id') id: string, @CurrentUser('sub') uid: string) {
    return this.svc.markDone(id, uid);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}

@Module({ controllers: [MaintenanceController], providers: [MaintenanceService] })
export class MaintenanceModule {}
