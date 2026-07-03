import { Controller, ForbiddenException, Get, Injectable, Module, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { computeDepreciation } from '../depreciation/depreciation.module';
import { ModuleGuard } from '../tenant-settings/module.guard';
import { RequireModule } from '../tenant-settings/require-module.decorator';
import { NavPermissionsGuard } from '../tenant-settings/nav-permissions.guard';
import { RequireNav } from '../tenant-settings/require-nav.decorator';

const REPORTS = ['assets', 'assets-by-category', 'assets-by-status', 'tickets', 'open-tickets', 'maintenance-due', 'license-compliance', 'depreciation'] as const;
type ReportKey = typeof REPORTS[number];

@Injectable()
class ReportsService {
  constructor(private readonly ctx: TenantContextService) {}

  catalog() {
    return REPORTS.map((k) => ({ key: k }));
  }

  async run(key: ReportKey, params: Record<string, string>) {
    const db = this.ctx.prisma();
    switch (key) {
      case 'assets': {
        const where: any = {};
        if (params.status) where.status = params.status;
        if (params.categoryId) where.categoryId = params.categoryId;
        if (params.locationId) where.locationId = params.locationId;
        const rows = await db.asset.findMany({
          where,
          include: {
            category: { select: { name: true } },
            location: { select: { name: true } },
            department: { select: { name: true } },
          },
        });
        return rows.map((a: any) => ({
          assetTag: a.assetTag, name: a.name, status: a.status,
          category: a.category?.name, location: a.location?.name, department: a.department?.name,
          purchaseCost: a.purchaseCost ? Number(a.purchaseCost) : null,
          warrantyEnd: a.warrantyEnd?.toISOString().slice(0, 10),
          serialNumber: a.serialNumber,
        }));
      }
      case 'assets-by-category': {
        // Outer-join: include categories with zero assets so the report reflects
        // the entire catalogue, not just categories currently in use.
        const cats = await db.category.findMany({
          include: { _count: { select: { assets: true } } },
          orderBy: { name: 'asc' },
        });
        return cats.map((c: any) => ({ category: c.name, count: c._count.assets }));
      }
      case 'assets-by-status': {
        const rows = await db.asset.groupBy({ by: ['status'], _count: { _all: true } });
        return rows.map((r: any) => ({ status: r.status, count: r._count._all }));
      }
      case 'tickets':
      case 'open-tickets': {
        const where: any = key === 'open-tickets' ? { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_VENDOR'] } } : {};
        const rows = await db.serviceTicket.findMany({
          where,
          include: {
            asset: { select: { assetTag: true, name: true } },
            assignedTo: { select: { firstName: true, lastName: true } },
            vendor: { select: { name: true } },
          },
        });
        return rows.map((t: any) => ({
          ticketNumber: t.ticketNumber, title: t.title, status: t.status, priority: t.priority,
          asset: t.asset?.assetTag, assetName: t.asset?.name,
          assignee: t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}` : null,
          vendor: t.vendor?.name,
          openedAt: t.openedAt?.toISOString(),
          resolvedAt: t.resolvedAt?.toISOString(),
          cost: t.cost ? Number(t.cost) : null,
        }));
      }
      case 'maintenance-due': {
        const rows = await db.maintenanceSchedule.findMany({
          where: { active: true },
          include: { asset: { select: { assetTag: true, name: true } } },
          orderBy: { nextDueAt: 'asc' },
        });
        return rows.map((m: any) => ({
          asset: m.asset?.assetTag, name: m.asset?.name, title: m.title,
          nextDueAt: m.nextDueAt?.toISOString().slice(0, 10),
          intervalDays: m.intervalDays,
          lastRunAt: m.lastRunAt?.toISOString().slice(0, 10),
          overdue: m.nextDueAt < new Date(),
        }));
      }
      case 'license-compliance': {
        const rows = await db.softwareLicense.findMany({
          include: {
            software: { select: { name: true } },
            assignments: { where: { returnedAt: null }, select: { id: true } },
          },
        });
        return rows.map((l: any) => ({
          software: l.software.name, type: l.type, seats: l.seats,
          used: l.assignments.length, free: Math.max(0, l.seats - l.assignments.length),
          overDeployed: l.assignments.length > l.seats,
          expiresAt: l.expiresAt?.toISOString().slice(0, 10),
        }));
      }
      case 'depreciation': {
        const assets = await db.asset.findMany({
          where: { depreciationMethod: { not: 'NONE' }, purchaseCost: { not: null } },
          include: { category: { select: { name: true } } },
        });
        const now = new Date();
        return assets.map((a: any) => {
          const r = computeDepreciation(a, now);
          return {
            assetTag: a.assetTag, name: a.name, category: a.category?.name,
            method: r.method, cost: r.cost, salvage: r.salvage, usefulLifeMonths: r.usefulLifeMonths,
            monthsElapsed: r.monthsElapsed, accumulated: r.accumulated, bookValue: r.bookValue,
          };
        });
      }
    }
  }
}

function round2(n: number) { return Math.round(n * 100) / 100; }

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ModuleGuard, RolesGuard, NavPermissionsGuard)
@RequireModule('reports')
@RequireNav('reports')
// Reports surface aggregate financial / lifecycle data the EMPLOYEE role has no
// business view over. Anything more granular than the dashboard tile counts
// (which the dashboard endpoint provides separately) requires manager+.
@Roles('ADMIN', 'ASSET_MANAGER')
@Controller('reports')
class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get()
  catalog() { return this.svc.catalog(); }

  @Get(':key')
  async run(
    @Res() res: Response,
    @Query() params: Record<string, string>,
    @Query('format') format?: string,
  ) {
    const key = (res.req.params as any).key as ReportKey;
    if (!REPORTS.includes(key)) { res.status(404).json({ message: 'Unknown report' }); return; }
    const rows = await this.svc.run(key, params);
    if ((format || params.format) === 'csv') {
      const headers = rows.length ? Object.keys(rows[0]) : [];
      const csv = [
        headers.join(','),
        ...rows.map((r: any) => headers.map((h) => escapeCsv(r[h])).join(',')),
      ].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${key}.csv"`);
      res.send(csv);
      return;
    }
    res.json({ key, rowCount: rows.length, rows });
  }
}

function escapeCsv(v: any): string {
  let s = v == null ? '' : String(v);
  // CSV-formula injection defence: cells starting with these chars get parsed as
  // formulas in Excel / Google Sheets. Prepend a single quote so they render as text.
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ------------ Observability ------------
@Injectable()
class MetricsService {
  startedAt = Date.now();
  counters: Record<string, number> = {};
  inc(k: string) { this.counters[k] = (this.counters[k] || 0) + 1; }
}

@ApiTags('observability')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('metrics')
class MetricsController {
  constructor(private readonly m: MetricsService) {}
  @Get()
  metrics(@Req() req: any) {
    // Guard-level @Roles('ADMIN') is authoritative; this stays as defence in depth.
    if (req.user?.role !== 'ADMIN') throw new ForbiddenException('Admin only');
    const mem = process.memoryUsage();
    return {
      uptimeMs: Date.now() - this.m.startedAt,
      memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
      counters: this.m.counters,
    };
  }
}

@Module({
  controllers: [ReportsController, MetricsController],
  providers: [ReportsService, MetricsService],
})
export class ReportsModule {}
