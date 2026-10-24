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
 * The recipe new entries are written with. See `computeEntryHash` for why it changed.
 *
 * v3 means "tenantId is in the hash payload", with no exceptions: `writeAuditEntry`
 * requires a tenantId, and v3 always writes the key. That invariant is what lets
 * verifyChain() pick the recipe from `hashVersion` alone.
 */
export const AUDIT_HASH_VERSION = 3;

/** Key used to snapshot the asset's identity inside the (hashed) detail blob. */
export const AUDIT_ASSET_SNAPSHOT_KEY = 'assetId';

/**
 * Compute a stable hash for an audit-log entry.
 * Each new entry chains the previous entry's hash so any tampering is detectable.
 *
 * Recipe versions
 * ---------------
 * v1 folded the `assetId` *column* into the hash. That column is mutable: deleting an
 * asset rewrites it to NULL on the asset's existing audit rows so the history survives
 * the cascade. Rewriting a hashed input invalidated those rows — and because the entries
 * are chained, every entry after the first one failed too. Ordinary deletions therefore
 * reported as tampering, which is precisely the signal this chain exists to give.
 *
 * v2 removes the column from the payload. The asset's identity is instead snapshotted
 * into `detail`, which is hashed and never rewritten, so the reference is still covered
 * by the chain while the mutable column is free to change.
 *
 * v3 adds `tenantId` to the hash payload. In the shared-table architecture (MySQL
 * migration), audit chains are per-tenant. Including tenantId in the hash cryptographically
 * binds each chain to its tenant, preventing cross-tenant chain grafting.
 *
 * Rows keep the version they were written with, so entries created before the change
 * continue to verify against v1/v2.
 */
export function computeEntryHash(input: {
  prevHash: string | null;
  action: string;
  assetId: string | null;
  performedById: string | null;
  detail: any;
  createdAt: Date;
  hashVersion?: number | null;
  tenantId?: string | null;
}): string {
  const base: Record<string, any> = {
    prev: input.prevHash || '',
    action: input.action,
    by: input.performedById || '',
    detail: input.detail ?? null,
    at: input.createdAt.toISOString(),
  };
  // v1 also covered the mutable column. `stableStringify` sorts keys, so adding it back
  // reproduces the original v1 payload byte-for-byte.
  if ((input.hashVersion ?? 1) < 2) base.assetId = input.assetId || '';
  // v3 binds the chain to the tenant (shared-table migration). The key is added
  // unconditionally for v3 — guarding on `input.tenantId` being truthy instead would
  // let a tenantId-less v3 row hash byte-for-byte identically to a v2 one, which is
  // exactly the ambiguity the version bump exists to rule out.
  if ((input.hashVersion ?? 1) >= 3) base.tenantId = input.tenantId || '';
  return crypto.createHash('sha256').update(stableStringify(base)).digest('hex');
}

/**
 * Insert an audit-log entry computed with a hash chain. The read-then-write takes
 * SELECT ... FOR UPDATE on the tenant's `AuditCounter` row, so concurrent writers
 * cannot read the same `prevHash` and fork the chain. The counter (rather than the
 * tail AuditLog row) is the lock target because locking the current tail cannot
 * stop a concurrent INSERT from appearing beside it — a phantom the counter row,
 * which always exists, does prevent.
 *
 * If the host Prisma client does not expose `$transaction` (e.g. a custom
 * test shim) the call falls back to the non-transactional path — still safe
 * during single-process tests.
 *
 * `impersonatedBy` is the platform-admin user id when the action was performed
 * by a platform operator through the /platform/tenants/:id/users/:userId/impersonate
 * flow. It is folded into the detail blob (and therefore into the chained
 * hash) so the action cannot be retroactively un-tagged as impersonated.
 *
 * `tenantId` is REQUIRED. Under shared tables every tenant owns an independent
 * chain, so an entry that cannot name its tenant has no chain to join. Making it
 * a required field means the compiler, not production, catches a missing one —
 * an earlier revision defaulted it to the string 'default', which silently merged
 * every tenant's chain into one.
 */
/**
 * Is this error a transient serialization / deadlock failure worth retrying?
 *
 * This exists to consolidate what were three separate hand-rolled tests that had
 * already drifted apart, not to fix a live bug — measurement against Postgres 17
 * through the pg adapter showed the previous version handled both shapes that can
 * actually occur here:
 *
 *   - a conflict on a TYPED query arrives as `P2034`, with the driver's own code in
 *     `meta.driverAdapterError.cause.originalCode`.
 *   - a conflict on a RAW query arrives as `P2010`, and the only trace of the real
 *     cause is the driver's text folded into `message` ("deadlock detected").
 *
 * Matching the word "deadlock" alone caught both, which is what the old test did.
 * The gap closed here is narrow and currently unreachable: a `40001`
 * serialization_failure raised by a raw statement would land as `P2010` with a
 * message saying "could not serialize access", matching neither "deadlock" nor
 * "lock wait timeout". Postgres only raises `40001` at RepeatableRead or
 * Serializable, and every transaction in this codebase runs ReadCommitted. Raise
 * one and this is already ready for it.
 *
 * MySQL's wording is kept so the predicate stays correct if the engine changes again.
 */
export function isSerializationFailure(e: any): boolean {
  const code = e?.code;
  const msg = e?.message || '';
  return (
    code === 'P2034' || code === '40001' || code === '40P01' ||
    /\b(40001|40P01)\b/.test(msg) ||
    /serializ|deadlock|lock wait timeout/i.test(msg)
  );
}

export async function writeAuditEntry(
  db: any,
  data: { tenantId: string; assetId?: string | null; action: string; performedById?: string | null; detail?: any; impersonatedBy?: string | null },
) {
  if (!data.tenantId) {
    throw new Error(`writeAuditEntry requires a tenantId (action: ${data.action}).`);
  }
  // Stamp impersonation onto the detail so platform-admin "view-as" actions
  // are unmistakable. We deliberately fold the marker into `detail` so the
  // chained hash also covers it — an impersonation tag cannot be retroactively
  // removed without invalidating the chain.
  let mergedDetail = data.impersonatedBy
    ? { ...(typeof data.detail === 'object' && data.detail !== null ? data.detail : { value: data.detail }), impersonatedBy: data.impersonatedBy }
    : (data.detail ?? null);

  // Snapshot the asset reference into the hashed detail (v2). The `assetId` column is
  // rewritten when an asset is deleted, so it cannot carry the reference in a way the
  // chain can vouch for; this copy is never rewritten. Only added when there is an
  // asset, and never clobbering a caller-supplied key of the same name.
  if (data.assetId) {
    const base = (typeof mergedDetail === 'object' && mergedDetail !== null)
      ? mergedDetail
      : (mergedDetail == null ? {} : { value: mergedDetail });
    if (!(AUDIT_ASSET_SNAPSHOT_KEY in base)) {
      mergedDetail = { ...base, [AUDIT_ASSET_SNAPSHOT_KEY]: data.assetId };
    }
  }
  data = { ...data, detail: mergedDetail };

  const tenantId = data.tenantId;

  const doIt = async (tx: any) => {
    // Serialize appends for THIS tenant only. Raw SQL because the lock has to be a
    // real FOR UPDATE; note it deliberately bypasses the tenant-scoping extension,
    // so the tenantId is bound explicitly here and reused for every write below —
    // read and write must name the same row or the lock guards nothing.
    const counters: any[] = await tx.$queryRawUnsafe(
      `SELECT "lastSeq", "lastHash" FROM "AuditCounter" WHERE "tenantId" = $1 FOR UPDATE`,
      tenantId,
    );
    if (counters.length === 0) {
      throw new Error(
        `AuditCounter row missing for tenant ${tenantId} (action: ${data.action}). ` +
        `Every tenant is seeded one at provisioning — see seedDefaults() in auth.service.ts.`,
      );
    }
    const lastHash: string | null = counters[0].lastHash ?? null;

    const createdAt = new Date();
    const entryHash = computeEntryHash({
      prevHash: lastHash,
      action: data.action,
      assetId: data.assetId || null,
      performedById: data.performedById || null,
      detail: data.detail ?? null,
      createdAt,
      hashVersion: AUDIT_HASH_VERSION,
      tenantId,
    });

    const newRow = await tx.auditLog.create({
      data: {
        tenantId,
        assetId: data.assetId || null,
        action: data.action,
        detail: data.detail ?? null,
        performedById: data.performedById || null,
        prevHash: lastHash,
        entryHash,
        hashVersion: AUDIT_HASH_VERSION,
        createdAt,
      },
    });

    // Advance the counter so the next append chains onto this entry. `lastSeq` is
    // not read back by the chain (linkage is hash-to-hash) but is kept current for
    // operators and for the consolidation script's seeding check.
    await tx.auditCounter.update({
      where: { tenantId },
      data: { lastSeq: newRow.seq, lastHash: newRow.entryHash },
    });

    return newRow;
  };

  if (typeof db.$transaction === 'function') {
    // ReadCommitted is sufficient because the FOR UPDATE above does the serializing;
    // the isolation level is not what keeps the chain linear.
    try {
      return await db.$transaction(doIt, { isolationLevel: 'ReadCommitted' });
    } catch (e: any) {
      // One retry is enough: the FOR UPDATE above is what serializes the chain, so a
      // loser only needs to re-read the counter it lost the race for.
      if (isSerializationFailure(e)) {
        return await db.$transaction(doIt, { isolationLevel: 'ReadCommitted' });
      }
      throw e;
    }
  }
  return doIt(db);
}
