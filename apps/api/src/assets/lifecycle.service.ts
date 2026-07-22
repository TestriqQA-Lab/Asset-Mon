import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { writeAuditEntry } from '../common/audit-hash';

@Injectable()
export class LifecycleService {
  constructor(private readonly ctx: TenantContextService) {}

  async checkout(assetId: string, userId: string, dueAt: string | null, performedById: string) {
    const db = this.ctx.prisma();
    const asset = await db.asset.findUnique({
      where: { id: assetId },
      include: { assignments: { where: { returnedAt: null }, take: 1 } },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.assignments.length > 0) throw new BadRequestException('Asset is already checked out');
    if (asset.status === 'ARCHIVED' || asset.status === 'LOST_STOLEN') {
      throw new BadRequestException(`Cannot check out asset in status ${asset.status}`);
    }
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    // Refuse if another user holds a confirmed reservation for the current window —
    // the reservation owner has priority.
    const now = new Date();
    const horizon = dueAt ? new Date(dueAt) : new Date(now.getTime() + 60 * 60_000);
    const conflict = await db.reservation.findFirst({
      where: {
        assetId,
        userId: { not: userId },
        status: { in: ['CONFIRMED', 'REQUESTED'] },
        startAt: { lte: horizon },
        endAt: { gt: now },
      },
    });
    if (conflict) {
      throw new BadRequestException(
        `Asset is reserved by another user until ${conflict.endAt.toISOString()}.`,
      );
    }

    const assignment = await db.assignment.create({
      data: { assetId, userId, dueAt: dueAt ? new Date(dueAt) : null },
    });
    await db.asset.update({ where: { id: assetId }, data: { status: 'ASSIGNED' } });
    await writeAuditEntry(db, { assetId, action: 'CHECKED_OUT', performedById, detail: { userId, dueAt }, impersonatedBy: this.ctx.impersonatedBy ?? null });
    return assignment;
  }

  async checkin(assetId: string, performedById: string) {
    const db = this.ctx.prisma();
    const open = await db.assignment.findFirst({ where: { assetId, returnedAt: null }, orderBy: { checkedOutAt: 'desc' } });
    if (!open) throw new BadRequestException('Asset is not checked out');
    const updated = await db.assignment.update({ where: { id: open.id }, data: { returnedAt: new Date() } });
    await db.asset.update({ where: { id: assetId }, data: { status: 'AVAILABLE' } });
    await writeAuditEntry(db, { assetId, action: 'CHECKED_IN', performedById, detail: { assignmentId: open.id }, impersonatedBy: this.ctx.impersonatedBy ?? null });
    return updated;
  }
}
