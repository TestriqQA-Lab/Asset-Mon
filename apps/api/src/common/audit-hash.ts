import * as crypto from 'crypto';

/**
 * Recursive deterministic JSON stringify — sorts object keys alphabetically so
 * Postgres JSONB key reordering on round-trip cannot break the hash chain.
 *
 * Postgres stores JSONB by hash bucket, *not* by source key order. When the
 * server hashes `{a:1, b:2}` at insert time and then re-reads it as `{b:2, a:1}`
 * for verification, vanilla JSON.stringify produces two different strings and
 * the chain check falsely flags a tamper. Sorting keys before hashing makes
 * the canonical form input-order-independent.
 */
function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k]));
  return '{' + parts.join(',') + '}';
}

/**
 * Compute a stable hash for an audit-log entry.
 * Each new entry chains the previous entry's hash so any tampering is detectable.
 */
export function computeEntryHash(input: {
  prevHash: string | null;
  action: string;
  assetId: string | null;
  performedById: string | null;
  detail: any;
  createdAt: Date;
}): string {
  const payload = stableStringify({
    prev: input.prevHash || '',
    action: input.action,
    assetId: input.assetId || '',
    by: input.performedById || '',
    detail: input.detail ?? null,
    at: input.createdAt.toISOString(),
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Insert an audit-log entry computed with a hash chain. The read-then-write is
 * wrapped in a serialisable transaction so concurrent writers produce a strictly
 * linear chain (no two entries can share `prevHash`).
 *
 * If the host Prisma client does not expose `$transaction` (e.g. a custom
 * test shim) the call falls back to the non-transactional path — still safe
 * during single-process tests.
 *
 * `impersonatedBy` is the platform-admin user id when the action was performed
 * by a platform operator through the /platform/tenants/:id/users/:userId/impersonate
 * flow. It is folded into the detail blob (and therefore into the chained
 * hash) so the action cannot be retroactively un-tagged as impersonated.
 */
export async function writeAuditEntry(
  db: any,
  data: { assetId?: string | null; action: string; performedById?: string | null; detail?: any; impersonatedBy?: string | null },
) {
  // Stamp impersonation onto the detail so platform-admin "view-as" actions
  // are unmistakable. We deliberately fold the marker into `detail` so the
  // chained hash also covers it — an impersonation tag cannot be retroactively
  // removed without invalidating the chain.
  const mergedDetail = data.impersonatedBy
    ? { ...(typeof data.detail === 'object' && data.detail !== null ? data.detail : { value: data.detail }), impersonatedBy: data.impersonatedBy }
    : (data.detail ?? null);
  data = { ...data, detail: mergedDetail };
  const doIt = async (tx: any) => {
    const last = await tx.auditLog.findFirst({ orderBy: { seq: 'desc' }, select: { entryHash: true } });
    const createdAt = new Date();
    const entryHash = computeEntryHash({
      prevHash: last?.entryHash || null,
      action: data.action,
      assetId: data.assetId || null,
      performedById: data.performedById || null,
      detail: data.detail ?? null,
      createdAt,
    });
    return tx.auditLog.create({
      data: {
        assetId: data.assetId || null,
        action: data.action,
        detail: data.detail ?? null,
        performedById: data.performedById || null,
        prevHash: last?.entryHash || null,
        entryHash,
        createdAt,
      },
    });
  };

  if (typeof db.$transaction === 'function') {
    try {
      return await db.$transaction(doIt, { isolationLevel: 'Serializable' });
    } catch (e: any) {
      // Postgres SQLSTATE 40001 = serialisation_failure; one retry is enough
      // under contended write conditions before bubbling up.
      if (e?.code === 'P2034' || /serial/i.test(e?.message || '')) {
        return await db.$transaction(doIt, { isolationLevel: 'Serializable' });
      }
      throw e;
    }
  }
  return doIt(db);
}
