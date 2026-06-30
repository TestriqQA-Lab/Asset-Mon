import { Injectable, NotFoundException } from '@nestjs/common';
import { CatalogPrismaService } from '../catalog/catalog-prisma.service';

// Company-side support: a tenant ADMIN opens/lists/reads help requests + posts messages.
// Everything is scoped to the caller's tenant id via loadOwned() (404 on mismatch), so
// one company can never see or touch another company's requests.
@Injectable()
export class SupportService {
  constructor(private readonly catalog: CatalogPrismaService) {}

  private async loadOwned(tenantId: string, requestId: string) {
    const r = await this.catalog.supportRequest.findUnique({ where: { id: requestId } });
    if (!r || r.tenantId !== tenantId) throw new NotFoundException('Request not found');
    return r;
  }

  async create(tenantId: string, createdByEmail: string, createdByUserId: string | null, subject: string, body: string) {
    return this.catalog.supportRequest.create({
      data: {
        tenantId,
        createdByEmail,
        createdByUserId,
        subject,
        status: 'OPEN',
        lastMessageAt: new Date(),
        platformUnreadAt: new Date(), // the operator hasn't seen it yet
        tenantUnreadAt: null,         // the company just wrote it
        messages: { create: { authorType: 'TENANT', authorEmail: createdByEmail, body } },
      },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async listByTenant(tenantId: string) {
    const rows = await this.catalog.supportRequest.findMany({
      where: { tenantId },
      orderBy: { lastMessageAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      status: r.status,
      lastMessageAt: r.lastMessageAt,
      unread: !!r.tenantUnreadAt,
      preview: r.messages[0]?.body?.slice(0, 140) || '',
    }));
  }

  async getForTenant(tenantId: string, requestId: string) {
    const r = await this.loadOwned(tenantId, requestId);
    if (r.tenantUnreadAt) {
      await this.catalog.supportRequest.update({ where: { id: r.id }, data: { tenantUnreadAt: null } });
    }
    const messages = await this.catalog.supportMessage.findMany({ where: { requestId: r.id }, orderBy: { createdAt: 'asc' } });
    return { id: r.id, subject: r.subject, status: r.status, createdAt: r.createdAt, messages };
  }

  async addTenantMessage(tenantId: string, requestId: string, authorEmail: string, body: string) {
    const r = await this.loadOwned(tenantId, requestId);
    await this.catalog.supportMessage.create({ data: { requestId: r.id, authorType: 'TENANT', authorEmail, body } });
    await this.catalog.supportRequest.update({
      where: { id: r.id },
      data: {
        platformUnreadAt: new Date(),
        tenantUnreadAt: null,
        lastMessageAt: new Date(),
        status: r.status === 'RESOLVED' ? 'OPEN' : r.status, // replying reopens a resolved request
      },
    });
    return { ok: true };
  }

  async tenantUnreadCount(tenantId: string) {
    const count = await this.catalog.supportRequest.count({ where: { tenantId, tenantUnreadAt: { not: null } } });
    return { count };
  }
}
