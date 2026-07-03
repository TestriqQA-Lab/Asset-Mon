import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, Module, NotFoundException,
  Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { IsISO8601, IsOptional, IsString } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { LifecycleService } from '../assets/lifecycle.service';
import { AssetsModule } from '../assets/assets.module';
import { ModuleGuard } from '../tenant-settings/module.guard';
import { RequireModule } from '../tenant-settings/require-module.decorator';
import { NavPermissionsGuard } from '../tenant-settings/nav-permissions.guard';
import { RequireNav } from '../tenant-settings/require-nav.decorator';

@Injectable()
class ReservationsService {
  constructor(
    private readonly ctx: TenantContextService,
    private readonly lifecycle: LifecycleService,
  ) {}

  list(filter: { assetId?: string; userId?: string; from?: string; to?: string; status?: string; upcoming?: boolean; viewerRole?: string; viewerId?: string }) {
    const where: any = {};
    if (filter.assetId) where.assetId = filter.assetId;
    if (filter.userId) where.userId = filter.userId;
    if (filter.status) where.status = filter.status;
    // EMPLOYEE only sees their own reservations regardless of supplied filters.
    if (filter.viewerRole === 'EMPLOYEE' && filter.viewerId) {
      where.userId = filter.viewerId;
    }
    if (filter.from || filter.to) {
      where.startAt = {};
      if (filter.from) where.startAt.gte = new Date(filter.from);
      if (filter.to) where.startAt.lte = new Date(filter.to);
    }
    if (filter.upcoming) {
      where.endAt = { gte: new Date() };
      where.status = { in: ['REQUESTED', 'CONFIRMED', 'CHECKED_OUT'] };
    }
    return this.ctx.prisma().reservation.findMany({
      where,
      orderBy: { startAt: 'asc' },
      include: {
        asset: { select: { id: true, assetTag: true, name: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async get(id: string, viewer?: { userId: string; role: string }) {
    const r = await this.ctx.prisma().reservation.findUnique({
      where: { id },
      include: {
        asset: { select: { id: true, assetTag: true, name: true, status: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!r) throw new NotFoundException('Reservation not found');
    // 404 (not 403) on cross-user reads — don't leak existence.
    if (viewer && viewer.role === 'EMPLOYEE' && r.userId !== viewer.userId) {
      throw new NotFoundException('Reservation not found');
    }
    return r;
  }

  async create(data: { assetId: string; userId: string; startAt: string; endAt: string; notes?: string }, actor: { userId: string; role: string }) {
    // EMPLOYEE may only request reservations for themselves; reject cross-user
    // bookings outright. ADMIN / ASSET_MANAGER may book on someone else's behalf.
    if (actor.role === 'EMPLOYEE' && data.userId !== actor.userId) {
      throw new ForbiddenException('Employees can only request reservations for themselves');
    }
    const start = new Date(data.startAt);
    const end = new Date(data.endAt);
    if (end <= start) throw new BadRequestException('endAt must be after startAt');
    const conflict = await this.findConflict(data.assetId, start, end);
    if (conflict) {
      throw new BadRequestException(
        `Conflicts with reservation ${conflict.id} (${conflict.startAt.toISOString()} → ${conflict.endAt.toISOString()})`,
      );
    }
    return this.ctx.prisma().reservation.create({
      data: {
        assetId: data.assetId,
        userId: data.userId,
        startAt: start,
        endAt: end,
        notes: data.notes || null,
        // Employee-requested reservations enter REQUESTED so an admin can confirm.
        // Manager / admin bookings go straight to CONFIRMED.
        status: actor.role === 'EMPLOYEE' ? 'REQUESTED' : 'CONFIRMED',
      },
      include: { asset: { select: { id: true, assetTag: true, name: true } } },
    });
  }

  async update(id: string, data: any, actor: { userId: string; role: string }) {
    const r = await this.ctx.prisma().reservation.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (actor.role === 'EMPLOYEE' && r.userId !== actor.userId) {
      // Hide existence — don't tell the EMPLOYEE that this reservation belongs
      // to someone else; pretend it isn't there.
      throw new NotFoundException();
    }
    if (['COMPLETED', 'CANCELLED'].includes(r.status)) throw new BadRequestException('Reservation is closed');
    const patch: any = { ...data };
    if (data.startAt) patch.startAt = new Date(data.startAt);
    if (data.endAt) patch.endAt = new Date(data.endAt);
    if (patch.startAt || patch.endAt) {
      const start = patch.startAt || r.startAt;
      const end = patch.endAt || r.endAt;
      if (end <= start) throw new BadRequestException('endAt must be after startAt');
      const conflict = await this.findConflict(r.assetId, start, end, id);
      if (conflict) throw new BadRequestException(`Conflicts with reservation ${conflict.id}`);
    }
    return this.ctx.prisma().reservation.update({ where: { id }, data: patch });
  }

  async cancel(id: string, actor: { userId: string; role: string }) {
    const db = this.ctx.prisma();
    const r = await db.reservation.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (actor.role === 'EMPLOYEE' && r.userId !== actor.userId) {
      throw new NotFoundException();
    }
    if (r.status === 'COMPLETED') throw new BadRequestException('Already completed');
    return db.reservation.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  async pickup(id: string, performedById: string, actor?: { userId: string; role: string }) {
    const db = this.ctx.prisma();
    const r = await db.reservation.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (actor && actor.role === 'EMPLOYEE' && r.userId !== actor.userId) {
      throw new NotFoundException();
    }
    if (r.status !== 'CONFIRMED') throw new BadRequestException(`Cannot pickup from status ${r.status}`);
    // Refuse pickup if the asset is currently checked out to someone else.
    const open = await db.assignment.findFirst({ where: { assetId: r.assetId, returnedAt: null } });
    if (open && open.userId !== r.userId) {
      throw new BadRequestException('Asset is currently checked out to another user.');
    }
    await this.lifecycle.checkout(r.assetId, r.userId, r.endAt.toISOString(), performedById);
    // Stash the freshly-created assignment id on the reservation notes for later
    // bookkeeping; the schema doesn't have a dedicated FK column yet.
    const assignment = await db.assignment.findFirst({
      where: { assetId: r.assetId, userId: r.userId, returnedAt: null },
      orderBy: { checkedOutAt: 'desc' },
    });
    return db.reservation.update({
      where: { id },
      data: {
        status: 'CHECKED_OUT',
        notes: assignment ? `${r.notes ? r.notes + '\n' : ''}[assignment:${assignment.id}]` : r.notes,
      },
    });
  }

  async returnReservation(id: string, performedById: string, actor?: { userId: string; role: string }) {
    const db = this.ctx.prisma();
    const r = await db.reservation.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (actor && actor.role === 'EMPLOYEE' && r.userId !== actor.userId) {
      throw new NotFoundException();
    }
    if (r.status !== 'CHECKED_OUT') throw new BadRequestException(`Cannot return from status ${r.status}`);
    // Prefer closing the assignment we ourselves created at pickup time.
    const tag = /\[assignment:([0-9a-f-]{36})\]/i.exec(r.notes || '');
    if (tag) {
      const a = await db.assignment.findFirst({ where: { id: tag[1], returnedAt: null } });
      if (a) {
        await db.assignment.update({ where: { id: a.id }, data: { returnedAt: new Date() } });
      } else {
        // Fall back to lifecycle.checkin which closes whatever the most recent open assignment is.
        await this.lifecycle.checkin(r.assetId, performedById);
      }
    } else {
      await this.lifecycle.checkin(r.assetId, performedById);
    }
    // If no other open assignment / open ticket remains, free the asset.
    const stillOpen = await db.assignment.count({ where: { assetId: r.assetId, returnedAt: null } });
    if (stillOpen === 0) {
      await db.asset.update({ where: { id: r.assetId }, data: { status: 'IN_STOCK' } }).catch(() => {});
    }
    return db.reservation.update({ where: { id }, data: { status: 'COMPLETED' } });
  }

  remove(id: string) {
    return this.ctx.prisma().reservation.delete({ where: { id } });
  }

  private async findConflict(assetId: string, start: Date, end: Date, excludeId?: string) {
    return this.ctx.prisma().reservation.findFirst({
      where: {
        assetId,
        status: { in: ['REQUESTED', 'CONFIRMED', 'CHECKED_OUT'] },
        ...(excludeId ? { id: { not: excludeId } } : {}),
        AND: [
          { startAt: { lt: end } },
          { endAt: { gt: start } },
        ],
      },
    });
  }
}

class CreateReservationDto {
  @IsString() assetId: string;
  @IsString() userId: string;
  @IsISO8601() startAt: string;
  @IsISO8601() endAt: string;
  @IsOptional() @IsString() notes?: string;
}
class UpdateReservationDto {
  @IsOptional() @IsISO8601() startAt?: string;
  @IsOptional() @IsISO8601() endAt?: string;
  @IsOptional() @IsString() notes?: string;
}

@ApiTags('reservations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ModuleGuard, RolesGuard, NavPermissionsGuard)
@RequireModule('reservations')
@RequireNav('reservations')
@Controller('reservations')
class ReservationsController {
  constructor(private readonly svc: ReservationsService) {}

  @Get()
  list(
    @CurrentUser('sub') uid: string,
    @CurrentUser('role') role: string,
    @Query('assetId') assetId?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('upcoming') upcoming?: string,
  ) {
    return this.svc.list({ assetId, userId, from, to, status, upcoming: upcoming === 'true', viewerRole: role, viewerId: uid });
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser('sub') uid: string, @CurrentUser('role') role: string) {
    return this.svc.get(id, { userId: uid, role });
  }

  @Post()
  @Roles('ADMIN', 'ASSET_MANAGER', 'EMPLOYEE')
  create(@Body() dto: CreateReservationDto, @CurrentUser('sub') uid: string, @CurrentUser('role') role: string) {
    return this.svc.create(dto, { userId: uid, role });
  }

  @Patch(':id')
  @Roles('ADMIN', 'ASSET_MANAGER', 'EMPLOYEE')
  update(@Param('id') id: string, @Body() dto: UpdateReservationDto, @CurrentUser('sub') uid: string, @CurrentUser('role') role: string) {
    return this.svc.update(id, dto, { userId: uid, role });
  }

  @Post(':id/cancel')
  @Roles('ADMIN', 'ASSET_MANAGER', 'EMPLOYEE')
  cancel(@Param('id') id: string, @CurrentUser('sub') uid: string, @CurrentUser('role') role: string) {
    return this.svc.cancel(id, { userId: uid, role });
  }

  // Pickup / return require physically taking custody of the asset, so they
  // remain admin/manager ops only — even though an employee may be the owner of
  // the reservation.
  @Post(':id/pickup')
  @Roles('ADMIN', 'ASSET_MANAGER')
  pickup(@Param('id') id: string, @CurrentUser('sub') uid: string, @CurrentUser('role') role: string) {
    return this.svc.pickup(id, uid, { userId: uid, role });
  }

  @Post(':id/return')
  @Roles('ADMIN', 'ASSET_MANAGER')
  return(@Param('id') id: string, @CurrentUser('sub') uid: string, @CurrentUser('role') role: string) {
    return this.svc.returnReservation(id, uid, { userId: uid, role });
  }

  @Delete(':id')
  @Roles('ADMIN', 'ASSET_MANAGER')
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}

@Module({
  imports: [AssetsModule], // for LifecycleService
  controllers: [ReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
