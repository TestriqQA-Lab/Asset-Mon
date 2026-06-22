import { createHash } from 'crypto';

/**
 * Stable hash for a PLATFORM audit-log entry (catalog PlatformAuditLog). Each
 * entry chains the previous entry's hash so tampering is detectable. Extracted
 * to a shared module so BOTH PlatformAuditService and the CLI break-glass script
 * compute the chain identically — the format can never drift between them.
 *
 * Metadata is stringified with sorted keys so JSONB key-reordering on round-trip
 * does not falsely break the chain.
 */
export function hashPlatformEntry(input: {
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
