import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CatalogPrismaService } from '../catalog/catalog-prisma.service';
import { PlatformAuditService } from './platform-audit.service';
import { assertSuperAdmin } from './platform-mfa.util';

type Actor = { id: string; email: string; role?: string };
const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];

// Operator-side support inbox. Reads span ALL tenants (the rows live in the catalog).
// Reads are SUPPORT-allowed; reply/status are SUPER_ADMIN-only and audited.
@Injectable()
export class PlatformSupportService {
  constructor(
    private readonly catalog: CatalogPrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  async list(filter: { status?: string }) {
    const where: any = {};
    if (filter.status && STATUSES.includes(filter.status)) where.status = filter.status;
    const rows = await this.catalog.supportRequest.findMany({
      where,
      orderBy: [{ platformUnreadAt: 'desc' }, { lastMessageAt: 'desc' }],
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      status: r.status,
      lastMessageAt: r.lastMessageAt,
      unread: !!r.platformUnreadAt,
      createdByEmail: r.createdByEmail,
      tenant: r.tenant,
      preview: r.messages[0]?.body?.slice(0, 140) || '',
    }));
  }

  async get(id: string) {
    const r = await this.catalog.supportRequest.findUnique({
      where: { id },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    });
    if (!r) throw new NotFoundException('Request not found');
    if (r.platformUnreadAt) {
      await this.catalog.supportRequest.update({ where: { id }, data: { platformUnreadAt: null } });
    }
    const messages = await this.catalog.supportMessage.findMany({ where: { requestId: id }, orderBy: { createdAt: 'asc' } });
    return { id: r.id, subject: r.subject, status: r.status, createdByEmail: r.createdByEmail, tenant: r.tenant, createdAt: r.createdAt, messages };
  }

  async unreadCount() {
    const count = await this.catalog.supportRequest.count({ where: { platformUnreadAt: { not: null } } });
    return { count };
  }

  async reply(actor: Actor, id: string, body: string, req?: any) {
    assertSuperAdmin(actor);
    const r = await this.catalog.supportRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Request not found');
    await this.catalog.supportMessage.create({ data: { requestId: id, authorType: 'PLATFORM', authorEmail: actor.email, body } });
    await this.catalog.supportRequest.update({
      where: { id },
      data: {
        tenantUnreadAt: new Date(),
        platformUnreadAt: null,
        lastMessageAt: new Date(),
        status: r.status === 'OPEN' ? 'IN_PROGRESS' : r.status,
      },
    });
    await this.audit.record(actor, 'support.reply', { type: 'supportRequest', id }, { tenantId: r.tenantId }, req);
    return { ok: true };
  }

  async setStatus(actor: Actor, id: string, status: string, req?: any) {
    assertSuperAdmin(actor);
    if (!STATUSES.includes(status)) throw new BadRequestException('Invalid status');
    const r = await this.catalog.supportRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Request not found');
    await this.catalog.supportRequest.update({ where: { id }, data: { status: status as any } });
    await this.audit.record(actor, 'support.setStatus', { type: 'supportRequest', id }, { from: r.status, to: status }, req);
    return { ok: true };
  }
}
