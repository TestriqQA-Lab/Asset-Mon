import { computeEntryHash, AUDIT_HASH_VERSION, AUDIT_ASSET_SNAPSHOT_KEY } from './audit-hash';

const at = new Date('2026-07-25T10:00:00.000Z');
const base = {
  prevHash: 'aaaa',
  action: 'UPDATED',
  performedById: 'user-1',
  detail: { name: 'thing' },
  createdAt: at,
};

describe('audit hash versioning', () => {
  test('v1 covers the assetId column (the original recipe is reproduced)', () => {
    const withAsset = computeEntryHash({ ...base, assetId: 'asset-1', hashVersion: 1 });
    const withoutAsset = computeEntryHash({ ...base, assetId: null, hashVersion: 1 });
    expect(withAsset).not.toBe(withoutAsset);
  });

  test('an unversioned row is treated as v1 (back-compat for entries written before the change)', () => {
    const explicit = computeEntryHash({ ...base, assetId: 'asset-1', hashVersion: 1 });
    expect(computeEntryHash({ ...base, assetId: 'asset-1' })).toBe(explicit);
    expect(computeEntryHash({ ...base, assetId: 'asset-1', hashVersion: null })).toBe(explicit);
  });

  test('v2 ignores the assetId column — nulling it cannot break the chain', () => {
    // This is the defect: deleting an asset rewrites assetId to NULL on its existing
    // audit rows. Under v1 that changed a hashed input and invalidated the entry (and,
    // being a chain, everything after it).
    const before = computeEntryHash({ ...base, assetId: 'asset-1', hashVersion: 2 });
    const afterAssetDeleted = computeEntryHash({ ...base, assetId: null, hashVersion: 2 });
    expect(afterAssetDeleted).toBe(before);
  });

  test('v2 still covers the asset identity via the detail snapshot', () => {
    const a = computeEntryHash({
      ...base, assetId: null, hashVersion: 2,
      detail: { name: 'thing', [AUDIT_ASSET_SNAPSHOT_KEY]: 'asset-1' },
    });
    const b = computeEntryHash({
      ...base, assetId: null, hashVersion: 2,
      detail: { name: 'thing', [AUDIT_ASSET_SNAPSHOT_KEY]: 'asset-2' },
    });
    expect(a).not.toBe(b);
  });

  test('v1 and v2 are distinct recipes, so a row cannot silently switch version', () => {
    const v1 = computeEntryHash({ ...base, assetId: 'asset-1', hashVersion: 1 });
    const v2 = computeEntryHash({ ...base, assetId: 'asset-1', hashVersion: 2 });
    expect(v1).not.toBe(v2);
  });

  test('every other field still affects the hash under v2', () => {
    const ref = computeEntryHash({ ...base, assetId: null, hashVersion: 2 });
    expect(computeEntryHash({ ...base, assetId: null, hashVersion: 2, action: 'DELETED' })).not.toBe(ref);
    expect(computeEntryHash({ ...base, assetId: null, hashVersion: 2, performedById: 'user-2' })).not.toBe(ref);
    expect(computeEntryHash({ ...base, assetId: null, hashVersion: 2, prevHash: 'bbbb' })).not.toBe(ref);
    expect(computeEntryHash({ ...base, assetId: null, hashVersion: 2, detail: { name: 'other' } })).not.toBe(ref);
    expect(computeEntryHash({ ...base, assetId: null, hashVersion: 2, createdAt: new Date('2026-07-25T10:00:01.000Z') })).not.toBe(ref);
  });

  test('key order in detail does not affect the hash (JSONB round-trip safety)', () => {
    const a = computeEntryHash({ ...base, assetId: null, hashVersion: 2, detail: { a: 1, b: 2 } });
    const b = computeEntryHash({ ...base, assetId: null, hashVersion: 2, detail: { b: 2, a: 1 } });
    expect(a).toBe(b);
  });

  test('v3 binds the entry to its tenant', () => {
    const a = computeEntryHash({ ...base, assetId: null, hashVersion: 3, tenantId: 'tenant-a' });
    const b = computeEntryHash({ ...base, assetId: null, hashVersion: 3, tenantId: 'tenant-b' });
    expect(a).not.toBe(b);
  });

  test('v2 and v3 are distinct recipes even when the tenantId is absent', () => {
    // The regression this guards: while v3 only added `tenantId` when it was truthy,
    // a v3 row written without one hashed byte-for-byte identically to v2. Every entry
    // then verified against the wrong recipe once the stored tenantId was fed back in.
    const v2 = computeEntryHash({ ...base, assetId: null, hashVersion: 2 });
    const v3NoTenant = computeEntryHash({ ...base, assetId: null, hashVersion: 3 });
    expect(v3NoTenant).not.toBe(v2);
  });

  test('v3 does not disturb how v1/v2 rows verify', () => {
    // Migrated rows keep their original version; passing the tenantId that the
    // shared-table migration backfilled must not change their hash.
    const v1 = computeEntryHash({ ...base, assetId: 'asset-1', hashVersion: 1 });
    const v2 = computeEntryHash({ ...base, assetId: 'asset-1', hashVersion: 2 });
    expect(computeEntryHash({ ...base, assetId: 'asset-1', hashVersion: 1, tenantId: 'tenant-a' })).toBe(v1);
    expect(computeEntryHash({ ...base, assetId: 'asset-1', hashVersion: 2, tenantId: 'tenant-a' })).toBe(v2);
  });

  test('every other field still affects the hash under v3', () => {
    const ref = computeEntryHash({ ...base, assetId: null, hashVersion: 3, tenantId: 'tenant-a' });
    expect(computeEntryHash({ ...base, assetId: null, hashVersion: 3, tenantId: 'tenant-a', action: 'DELETED' })).not.toBe(ref);
    expect(computeEntryHash({ ...base, assetId: null, hashVersion: 3, tenantId: 'tenant-a', prevHash: 'bbbb' })).not.toBe(ref);
    expect(computeEntryHash({ ...base, assetId: null, hashVersion: 3, tenantId: 'tenant-a', detail: { name: 'other' } })).not.toBe(ref);
  });

  test('new entries are written with the current version', () => {
    expect(AUDIT_HASH_VERSION).toBe(3);
  });
});
