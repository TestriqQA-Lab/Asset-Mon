import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../tenancy/tenant-context.service';

const DAY = 24 * 60 * 60 * 1000;

// Read-only data-hygiene checks (Slice 7d). Mirrors the query style of
// DashboardService.alerts(): one Promise.all over the tenant client, each check
// returning a count + a small sample for drill-down. No mutations, no audit.
@Injectable()
export class DataQualityService {
  constructor(private readonly ctx: TenantContextService) {}

  async issues() {
    const db = this.ctx.prisma();
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * DAY);
    const staleBefore = new Date(now.getTime() - 30 * DAY);

    // `any` on the where objects avoids enum-literal widening friction while keeping
    // each clause defined once (used for both count + sample).
    // The "assets with no location" check was dropped along with the Location UI —
    // with no way to set a location it would flag every asset.
    const noOwner: any = { status: 'ASSIGNED', assignments: { none: { returnedAt: null } } };
    const overdueMaint: any = { active: true, nextDueAt: { lt: now } };
    const expLic: any = { expiresAt: { not: null, lte: in30 } };
    const staleTicket: any = { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_VENDOR'] }, updatedAt: { lt: staleBefore } };

    const [
      noOwnerCount, noOwnerSample,
      maintCount, maintSample,
      licCount, licSample,
      ticketCount, ticketSample,
    ] = await Promise.all([
      db.asset.count({ where: noOwner }),
      db.asset.findMany({ where: noOwner, select: { id: true, assetTag: true, name: true }, orderBy: { assetTag: 'asc' }, take: 8 }),
      db.maintenanceSchedule.count({ where: overdueMaint }),
      db.maintenanceSchedule.findMany({ where: overdueMaint, select: { id: true, title: true, nextDueAt: true, asset: { select: { assetTag: true, name: true } } }, orderBy: { nextDueAt: 'asc' }, take: 8 }),
      db.softwareLicense.count({ where: expLic }),
      db.softwareLicense.findMany({ where: expLic, select: { id: true, expiresAt: true, software: { select: { name: true } } }, orderBy: { expiresAt: 'asc' }, take: 8 }),
      db.serviceTicket.count({ where: staleTicket }),
      db.serviceTicket.findMany({ where: staleTicket, select: { id: true, ticketNumber: true, title: true, status: true, updatedAt: true }, orderBy: { updatedAt: 'asc' }, take: 8 }),
    ]);

    const d = (v: Date | null | undefined) => (v ? new Date(v).toLocaleDateString() : '');

    return {
      checks: [
        {
          key: 'assets-no-owner', label: 'Assigned but unowned', count: noOwnerCount, href: '/dashboard/assets',
          sample: noOwnerSample.map((a: any) => ({ id: a.id, primary: a.assetTag, secondary: a.name })),
        },
        {
          key: 'overdue-maintenance', label: 'Overdue maintenance', count: maintCount, href: '/dashboard/maintenance',
          sample: maintSample.map((m: any) => ({ id: m.id, primary: m.asset?.assetTag || m.title, secondary: `${m.title} · due ${d(m.nextDueAt)}` })),
        },
        {
          key: 'expiring-licenses', label: 'Licences expiring or expired', count: licCount, href: '/dashboard/licenses',
          sample: licSample.map((l: any) => ({ id: l.id, primary: l.software?.name || 'Licence', secondary: l.expiresAt ? `expires ${d(l.expiresAt)}` : '' })),
        },
        {
          key: 'stale-tickets', label: 'Stale open tickets', count: ticketCount, href: '/dashboard/tickets',
          sample: ticketSample.map((t: any) => ({ id: t.id, primary: t.ticketNumber, secondary: `${t.title} · ${t.status} · updated ${d(t.updatedAt)}` })),
        },
      ],
    };
  }
}
