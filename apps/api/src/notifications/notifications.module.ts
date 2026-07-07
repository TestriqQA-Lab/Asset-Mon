import { BadRequestException, Body, Controller, Get, Global, Injectable, Module, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { CurrentUser } from '../auth/current-user.decorator';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_KINDS = new Set([
  'ticket.assigned', 'ticket.opened', 'ticket.status_changed',
  'warranty.expiring', 'maint.due', 'license.expiring',
  'asset.checked_out', 'asset.checked_in', 'system',
  // Phase 2 RBAC: asset requests + purchase request routing
  'asset_request.created', 'asset_request.escalated',
  'asset_request.approved', 'asset_request.declined', 'asset_request.fulfilled', 'asset_request.note',
  'purchase_request.submitted', 'purchase_request.approved', 'purchase_request.rejected',
]);

// Only same-origin relative paths are allowed in notification hrefs. javascript:,
// data:, vbscript: and absolute external URLs are rejected so a future caller can't
// smuggle a click-jacking / XSS sink into the inbox bell.
const HREF_RE = /^\/[A-Za-z0-9/_\-?=&%.#]*$/;
function safeHref(input?: string | null): string | null {
  if (!input) return null;
  return HREF_RE.test(input) ? input : null;
}

function normaliseKind(kind: string): string {
  return ALLOWED_KINDS.has(kind) ? kind : 'system';
}

@Injectable()
export class NotificationsService {
  constructor(private readonly ctx: TenantContextService) {}

  listForUser(userId: string, limit = 30, unreadOnly = false) {
    return this.ctx.prisma().notification.findMany({
      where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, limit),
    });
  }

  countUnread(userId: string) {
    return this.ctx.prisma().notification.count({ where: { userId, readAt: null } });
  }

  markRead(userId: string, id: string) {
    return this.ctx.prisma().notification.updateMany({ where: { id, userId }, data: { readAt: new Date() } });
  }

  markAllRead(userId: string) {
    return this.ctx.prisma().notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  }

  /** Fire-and-forget create — used by other services. Kind is whitelisted; long fields truncated. */
  async push(data: { userId?: string | null; title: string; body?: string | null; href?: string | null; kind: string }) {
    return this.ctx.prisma().notification.create({
      data: {
        kind: normaliseKind(data.kind),
        title: String(data.title || '').slice(0, 200),
        body: data.body ? String(data.body).slice(0, 500) : null,
        href: safeHref(data.href ? String(data.href).slice(0, 300) : null),
        userId: data.userId || null,
      },
    });
  }

  async broadcast(role: string | null, data: { title: string; body?: string; href?: string; kind: string }) {
    const db = this.ctx.prisma();
    const users = await db.user.findMany({ where: role ? { role: role as any, active: true } : { active: true }, select: { id: true } });
    if (!users.length) return { sent: 0 };
    const safe = {
      kind: normaliseKind(data.kind),
      title: String(data.title || '').slice(0, 200),
      body: data.body ? String(data.body).slice(0, 500) : null,
      href: safeHref(data.href ? String(data.href).slice(0, 300) : null),
    };
    await db.notification.createMany({ data: users.map((u: any) => ({ ...safe, userId: u.id })) });
    return { sent: users.length };
  }
}

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@CurrentUser('sub') uid: string, @Query('unread') unread?: string, @Query('limit') limit?: string) {
    return this.svc.listForUser(uid, limit ? Number(limit) : 30, unread === 'true');
  }

  @Get('count')
  async count(@CurrentUser('sub') uid: string) {
    return { unread: await this.svc.countUnread(uid) };
  }

  @Post(':id/read')
  async read(@CurrentUser('sub') uid: string, @Param('id') id: string) {
    if (!UUID_RE.test(id)) throw new BadRequestException('Invalid id');
    await this.svc.markRead(uid, id);
    return { ok: true };
  }

  @Post('read-all')
  async readAll(@CurrentUser('sub') uid: string) {
    await this.svc.markAllRead(uid);
    return { ok: true };
  }
}

@Global()
@Module({ controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
