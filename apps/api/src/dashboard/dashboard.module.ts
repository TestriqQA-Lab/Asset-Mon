import { Controller, Get, Injectable, Module, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';

@Injectable()
class DashboardService {
  constructor(private readonly ctx: TenantContextService) {}

  async stats(uid: string) {
    const db = this.ctx.prisma();
    const [total, byStatusRows, byCategoryRows, openAssignments, warrantyExpiringSoon, openTickets, dueMaintenance, licensesExpiringSoon, recentActivity, myOpenTickets, myAssignedAssets] = await Promise.all([
      db.asset.count(),
      db.asset.groupBy({ by: ['status'], _count: { _all: true } }),
      db.asset.groupBy({ by: ['categoryId'], _count: { _all: true } }),
      db.assignment.count({ where: { returnedAt: null } }),
      db.asset.count({
        where: {
          warrantyEnd: { not: null, lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), gte: new Date() },
        },
      }),
      db.serviceTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_VENDOR'] } } }),
      db.maintenanceSchedule.count({ where: { active: true, nextDueAt: { lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } } }),
      db.softwareLicense.count({ where: { expiresAt: { not: null, lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), gte: new Date() } } }),
      db.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          asset: { select: { id: true, assetTag: true, name: true } },
          performedBy: { select: { firstName: true, lastName: true } },
        },
      }),
      // The current user's OWN counts — used by the employee dashboard cards
      // (workspace-wide counts above are not "mine").
      db.serviceTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_VENDOR'] }, OR: [{ openedById: uid }, { assignedToId: uid }] } }),
      db.assignment.count({ where: { userId: uid, returnedAt: null } }),
    ]);

    const cats = await db.category.findMany({ select: { id: true, name: true } });
    const catMap = new Map(cats.map((c) => [c.id, c.name]));

    return {
      total,
      byStatus: Object.fromEntries(byStatusRows.map((r: any) => [r.status, r._count._all])),
      byCategory: byCategoryRows.map((r: any) => ({ id: r.categoryId, name: catMap.get(r.categoryId) || '?', count: r._count._all })),
      openAssignments,
      warrantyExpiringSoon,
      openTickets,
      dueMaintenance,
      licensesExpiringSoon,
      recentActivity,
      myOpenTickets,
      myAssignedAssets,
    };
  }

  async alerts() {
    const db = this.ctx.prisma();
    const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const in7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const now = new Date();
    const [warranty, overdue, dueMaintenance, openTickets, expiringLicenses] = await Promise.all([
      db.asset.findMany({
        where: { warrantyEnd: { not: null, lte: in30, gte: now } },
        select: { id: true, assetTag: true, name: true, warrantyEnd: true },
        orderBy: { warrantyEnd: 'asc' },
        take: 50,
      }),
      db.assignment.findMany({
        where: { returnedAt: null, dueAt: { not: null, lt: now } },
        include: {
          asset: { select: { id: true, assetTag: true, name: true } },
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { dueAt: 'asc' },
        take: 50,
      }),
      db.maintenanceSchedule.findMany({
        where: { active: true, nextDueAt: { lte: in7 } },
        include: { asset: { select: { id: true, assetTag: true, name: true } } },
        orderBy: { nextDueAt: 'asc' },
        take: 50,
      }),
      db.serviceTicket.findMany({
        where: { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_VENDOR'] } },
        include: {
          asset: { select: { id: true, assetTag: true, name: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: [{ priority: 'desc' }, { openedAt: 'desc' }],
        take: 50,
      }),
      db.softwareLicense.findMany({
        where: { expiresAt: { not: null, lte: in30, gte: now } },
        include: { software: { select: { id: true, name: true } } },
        orderBy: { expiresAt: 'asc' },
        take: 50,
      }),
    ]);
    return { warranty, overdue, dueMaintenance, openTickets, expiringLicenses };
  }
}

@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('dashboard')
class DashboardController {
  constructor(private readonly svc: DashboardService) {}
  // Aggregate counts only — safe for any authenticated workspace member.
  @Get('stats') stats(@CurrentUser('sub') uid: string) { return this.svc.stats(uid); }
  // Alerts surface specific overdue assignments / tickets that include user
  // names + emails. Keep it manager+ — EMPLOYEE sees only the dashboard tile
  // counts via /stats.
  @Get('alerts') @Roles('ADMIN', 'ASSET_MANAGER') alerts() { return this.svc.alerts(); }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
