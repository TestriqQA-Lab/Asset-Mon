import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { CatalogPrismaService } from '../catalog/catalog-prisma.service';

/**
 * Append-only platform audit log. We never throw out of `record` — losing one
 * audit row should never block the actual mutation, but we *do* link each row
 * back to the previous one via a SHA-256 hash chain so a rogue catalog admin
 * cannot quietly rewrite history without detection.
 *
 * The chain is per-actor-independent (i.e. a single global chain): writing
 * happens inside a serializable transaction so concurrent writers can't fork
 * the chain at the same `prevHash`.
 */
@Injectable()
export class PlatformAuditService {
  constructor(private readonly catalog: CatalogPrismaService) {}

  /**
   * Stable hash of an entry. We intentionally hash *normalised* metadata (JSON
   * stringification with sorted keys) so the same logical event always hashes
   * the same way regardless of property order, and so a forensic auditor can
   * recompute the chain offline.
   */
  private hashEntry(input: {
    prevHash: string | null;
    actorId: string;
    actorEmail: string;
    action: string;
    targetType: string | null;
    targetId: string | null;
    metadata: Record<string, any>;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
  }): string {
    const stableMeta = JSON.stringify(input.metadata, Object.keys(input.metadata).sort());
    const payload = [
      input.prevHash ?? '',
      input.actorId,
      input.actorEmail,
      input.action,
      input.targetType ?? '',
      input.targetId ?? '',
      stableMeta,
      input.ipAddress ?? '',
      input.userAgent ?? '',
      input.createdAt.toISOString(),
    ].join('|');
    return createHash('sha256').update(payload).digest('hex');
  }

  async record(
    actor: { id: string; email: string },
    action: string,
    target?: { type: string; id: string },
    metadata: Record<string, any> = {},
    req?: any,
  ) {
    const ip =
      (req?.headers?.['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() ||
      req?.ip ||
      null;
    const ua = (req?.headers?.['user-agent'] as string | undefined) || null;
    const createdAt = new Date();

    // Try the tamper-evident chained write first. If the schema is on an
    // older revision (migration not yet applied) the new columns won't exist
    // and the chained query will fail — in that case we fall back to a plain
    // append so observability never silently dies.
    try {
      await this.catalog.$transaction(
        async (tx) => {
          const prev = await tx.platformAuditLog.findFirst({
            orderBy: { seq: 'desc' },
            select: { entryHash: true },
          });
          const entryHash = this.hashEntry({
            prevHash: prev?.entryHash ?? null,
            actorId: actor.id,
            actorEmail: actor.email,
            action,
            targetType: target?.type ?? null,
            targetId: target?.id ?? null,
            metadata,
            ipAddress: ip,
            userAgent: ua,
            createdAt,
          });
          await tx.platformAuditLog.create({
            data: {
              actorId: actor.id,
              actorEmail: actor.email,
              action,
              targetType: target?.type ?? null,
              targetId: target?.id ?? null,
              metadata,
              ipAddress: ip || null,
              userAgent: ua,
              prevHash: prev?.entryHash ?? null,
              entryHash,
              createdAt,
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
      return;
    } catch {
      /* fall through to legacy write */
    }

    try {
      await this.catalog.platformAuditLog.create({
        data: {
          actorId: actor.id,
          actorEmail: actor.email,
          action,
          targetType: target?.type ?? null,
          targetId: target?.id ?? null,
          metadata,
          ipAddress: ip || null,
        },
      });
    } catch {
      /* never block the calling action on audit failure */
    }
  }
}
