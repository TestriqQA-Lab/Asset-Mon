import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { assertTenantRefs } from '../tenancy/assert-tenant-refs';
import { EventBusService } from '../events/events.module';
import { ModuleGuard } from '../tenant-settings/module.guard';
import { RequireModule } from '../tenant-settings/require-module.decorator';
import { NavPermissionsGuard } from '../tenant-settings/nav-permissions.guard';
import { RequireNav } from '../tenant-settings/require-nav.decorator';
import { writeAuditEntry } from '../common/audit-hash';
import { NotificationsService } from '../notifications/notifications.module';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_VENDOR', 'RESOLVED', 'CLOSED', 'CANCELLED'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

@Injectable()
class TicketsService {
  constructor(
    private readonly ctx: TenantContextService,
    private readonly events: EventBusService,
    private readonly notifications: NotificationsService,
  ) {}

  list(filter: { assetId?: string; status?: string; assignedToId?: string; mine?: boolean; userId?: string; role?: string }) {
    const where: any = {};
    if (filter.assetId) where.assetId = filter.assetId;
    if (filter.status) {
      // Accept the synthetic "open" group so the dashboard's "Open tickets" card
      // filter matches the count it advertises (OPEN + IN_PROGRESS + WAITING_VENDOR).
      const s = String(filter.status).toLowerCase();
      if (s === 'open') where.status = { in: ['OPEN', 'IN_PROGRESS', 'WAITING_VENDOR'] };
      else where.status = filter.status;
    }
    if (filter.assignedToId) where.assignedToId = filter.assignedToId;
    // EMPLOYEE never sees tickets that are not their own (regardless of `mine` flag).
    // Privacy + RBAC: tickets contain the asset history, comments, and may surface
    // PII about other users' issues. Force-scope to opener-or-assignee.
    if (filter.role === 'EMPLOYEE' && filter.userId) {
      where.OR = [{ openedById: filter.userId }, { assignedToId: filter.userId }];
    } else if (filter.mine && filter.userId) {
      where.OR = [{ openedById: filter.userId }, { assignedToId: filter.userId }];
    }
    return this.ctx.prisma().serviceTicket.findMany({
      where,
      orderBy: [{ status: 'asc' }, { openedAt: 'desc' }],
      include: {
        asset: { select: { id: true, assetTag: true, name: true } },
        openedBy: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        vendor: { select: { id: true, name: true } },
      },
    });
  }

  async get(id: string, viewer?: { userId: string; role: string }) {
    const t = await this.ctx.prisma().serviceTicket.findUnique({
      where: { id },
      include: {
        asset: { select: { id: true, assetTag: true, name: true } },
        openedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        vendor: true,
      },
    });
    // 404 (not 403) on cross-user reads so existence is not leaked.
    if (!t) throw new NotFoundException('Ticket not found');
    if (viewer && viewer.role === 'EMPLOYEE') {
      if (t.openedById !== viewer.userId && t.assignedToId !== viewer.userId) {
        throw new NotFoundException('Ticket not found');
      }
    }
    return t;
  }

  async create(data: any, openedById: string, openedByRole?: string) {
    const db = this.ctx.prisma();
    await assertTenantRefs(db, {
      asset: data.assetId,
      user: data.assignedToId,
      vendor: data.vendorId,
    });
    const ticketNumber = await this.nextTicketNumber();
    // EMPLOYEE may only raise a ticket — they cannot pre-assign or pick a vendor.
    // Drop those fields on input so a crafted body cannot escalate by setting an
    // ASSET_MANAGER as the assignee for a fictitious issue.
    const restricted = openedByRole === 'EMPLOYEE';
    const ticket = await db.serviceTicket.create({
      data: {
        tenantId: this.ctx.tenantId!,
        ticketNumber,
        assetId: data.assetId,
        title: data.title,
        description: data.description || null,
        priority: data.priority || 'MEDIUM',
        status: 'OPEN',
        openedById,
        assignedToId: restricted ? null : (data.assignedToId || null),
        vendorId: restricted ? null : (data.vendorId || null),
      },
    });
    if ((['OUT_OF_SERVICE', 'AVAILABLE', 'ASSIGNED'] as const).includes((await db.asset.findUnique({ where: { id: data.assetId } }))?.status as any)) {
      // mark asset out of service if previously not
      const a = await db.asset.findUnique({ where: { id: data.assetId } });
      if (a && a.status !== 'OUT_OF_SERVICE') {
        await db.asset.update({ where: { id: data.assetId }, data: { status: 'OUT_OF_SERVICE' } });
      }
    }
    await writeAuditEntry(db, { tenantId: this.ctx.tenantId!, assetId: data.assetId, action: 'TICKET_OPENED', performedById: openedById, detail: { ticketId: ticket.id, title: ticket.title } });
    // notify assignee if any
    const emails = [];
    if (ticket.assignedToId) {
      const a = await db.user.findUnique({ where: { id: ticket.assignedToId } });
      if (a) emails.push({
        to: a.email,
        subject: `[AssetMon] Ticket ${ticket.ticketNumber}: ${ticket.title}`,
        body: `You have been assigned ticket ${ticket.ticketNumber}.\n\n${ticket.description || ''}\n`,
      });
    }
    this.events.emit('ticket.opened', {
      id: ticket.id, ticketNumber: ticket.ticketNumber, title: ticket.title, priority: ticket.priority, assetId: ticket.assetId,
    }, { emails }).catch(() => {});
    if (ticket.assignedToId) {
      this.notifications.push({
        userId: ticket.assignedToId,
        kind: 'ticket.assigned',
        title: `Ticket ${ticket.ticketNumber} assigned to you`,
        body: ticket.title,
        href: `/dashboard/tickets/${ticket.id}`,
      }).catch(() => {});
    } else if (openedByRole === 'EMPLOYEE') {
      // Phase 2 RBAC: employee ticket with no assignee → notify all Asset Managers
      // so the ticket doesn't go into a black hole. Manager escalates to Admin if needed.
      const managers = await db.user.findMany({
        where: { role: 'ASSET_MANAGER', active: true },
        select: { id: true, email: true },
      });
      for (const mgr of managers) {
        this.notifications.push({
          userId: mgr.id,
          kind: 'ticket.opened',
          title: `New employee ticket ${ticket.ticketNumber}`,
          body: ticket.title,
          href: `/dashboard/tickets/${ticket.id}`,
        }).catch(() => {});
      }
      // Also email the managers.
      const mgrEmails = managers.map((m) => ({
        to: m.email,
        subject: `[AssetMon] New ticket ${ticket.ticketNumber}: ${ticket.title}`,
        body: `An employee has raised ticket ${ticket.ticketNumber}.\n\n${ticket.description || ''}\n`,
      }));
      if (mgrEmails.length) {
        this.events.emit('ticket.opened', {
          id: ticket.id, ticketNumber: ticket.ticketNumber, title: ticket.title,
        }, { emails: mgrEmails }).catch(() => {});
      }
    }
    return ticket;
  }

  async update(id: string, data: any, performedById: string) {
    const db = this.ctx.prisma();
    const before = await db.serviceTicket.findUnique({ where: { id } });
    // 404, not 400: the scoped client returns nothing both for a ticket that does not
    // exist and for one belonging to another tenant, and those must look identical.
    if (!before) throw new NotFoundException('Ticket not found');
    await assertTenantRefs(db, { user: data.assignedToId, vendor: data.vendorId });
    const patch: any = { ...data };
    if (data.cost !== undefined) patch.cost = data.cost === null || data.cost === '' ? null : Number(data.cost);
    if (data.status && data.status !== before.status) {
      if (['RESOLVED', 'CLOSED', 'CANCELLED'].includes(data.status)) {
        patch.resolvedAt = new Date();
      }
    }
    const t = await db.serviceTicket.update({ where: { id }, data: patch });

    // Asset-state reconciliation. Resolving the last open ticket frees the asset;
    // reopening a previously-resolved ticket puts it back into IN_REPAIR.
    if (data.status && data.status !== before.status) {
      const wasOpen = ['OPEN', 'IN_PROGRESS', 'WAITING_VENDOR'].includes(before.status);
      const isOpen = ['OPEN', 'IN_PROGRESS', 'WAITING_VENDOR'].includes(data.status);
      const asset = await db.asset.findUnique({ where: { id: before.assetId }, select: { id: true, status: true } });
      if (asset) {
        if (!isOpen) {
          // Ticket has just left the open set — if nothing else is keeping the asset busy, clear it.
          const others = await db.serviceTicket.count({
            where: { assetId: before.assetId, id: { not: id }, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_VENDOR'] } },
          });
          if (others === 0 && asset.status === 'OUT_OF_SERVICE') {
            await db.asset.update({ where: { id: asset.id }, data: { status: 'AVAILABLE' } });
          }
        } else if (!wasOpen && asset.status !== 'OUT_OF_SERVICE') {
          // Ticket re-opened — put the asset back out of service so its dashboard tile is honest.
          await db.asset.update({ where: { id: asset.id }, data: { status: 'OUT_OF_SERVICE' } });
        }
      }
    }
    await writeAuditEntry(db, { tenantId: this.ctx.tenantId!, assetId: before.assetId, action: 'TICKET_UPDATED', performedById, detail: { ticketId: id, status: t.status } });
    if (data.status && data.status !== before.status) {
      this.events.emit('ticket.status_changed', {
        id, ticketNumber: t.ticketNumber, status: t.status, prevStatus: before.status,
      }).catch(() => {});
    }
    return t;
  }

  async remove(id: string) {
    return this.ctx.prisma().serviceTicket.delete({ where: { id } });
  }

  private async nextTicketNumber(): Promise<string> {
    const count = await this.ctx.prisma().serviceTicket.count();
    return `T-${String(count + 1).padStart(5, '0')}`;
  }
}

class CreateTicketDto {
  @IsUUID() assetId: string;
  @IsString() @MinLength(1) title: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(PRIORITIES) priority?: typeof PRIORITIES[number];
  @IsOptional() @IsUUID() assignedToId?: string;
  @IsOptional() @IsUUID() vendorId?: string;
}
class UpdateTicketDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(STATUSES) status?: typeof STATUSES[number];
  @IsOptional() @IsIn(PRIORITIES) priority?: typeof PRIORITIES[number];
  @IsOptional() @IsString() assignedToId?: string | null;
  @IsOptional() @IsString() vendorId?: string | null;
  @IsOptional() @IsString() resolution?: string;
  @IsOptional() @IsNumber() cost?: number;
}

@ApiTags('tickets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ModuleGuard, RolesGuard, NavPermissionsGuard)
@RequireModule('tickets')
@RequireNav('tickets')
@Controller('tickets')
class TicketsController {
  constructor(private readonly svc: TicketsService) {}

  @Get()
  list(
    @Query('assetId') assetId?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('mine') mine?: string,
    @CurrentUser('sub') uid?: string,
    @CurrentUser('role') role?: string,
  ) {
    return this.svc.list({ assetId, status, assignedToId, mine: mine === 'true', userId: uid, role });
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser('sub') uid: string, @CurrentUser('role') role: string) {
    return this.svc.get(id, { userId: uid, role });
  }

  @Post()
  @Roles('ADMIN', 'ASSET_MANAGER', 'EMPLOYEE')
  create(@Body() dto: CreateTicketDto, @CurrentUser('sub') uid: string, @CurrentUser('role') role: string) {
    return this.svc.create(dto, uid, role);
  }

  @Patch(':id')
  @Roles('ADMIN', 'ASSET_MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateTicketDto, @CurrentUser('sub') uid: string) {
    return this.svc.update(id, dto, uid);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}

@Module({ controllers: [TicketsController], providers: [TicketsService] })
export class TicketsModule {}
