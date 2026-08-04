import { Prisma } from '@assetmon/db';
import { TENANT_SCOPED_MODELS, scopedClient } from './scoped-client';

/** Every model in the schema that actually carries a `tenantId` column. */
function modelsWithTenantId(): string[] {
  return Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'tenantId' && f.kind === 'scalar'))
    .map((m) => m.name)
    .sort();
}

/**
 * Models that carry a `tenantId` but are deliberately NOT auto-scoped. Each one is
 * cross-tenant by design and takes responsibility for its own filtering; adding to
 * this list is a decision, which is why it lives next to the assertion.
 */
const INTENTIONALLY_UNSCOPED: Record<string, string> = {
  // Login has to ask "which workspaces does this email belong to?" before any tenant
  // context exists. Auto-scoping it would make that question unanswerable.
  TenantUser: 'cross-tenant by nature — resolves email → tenants during login',
  // The company↔operator support channel. The operator inbox reads across all
  // tenants; the company side scopes itself (SupportService.loadOwned checks
  // r.tenantId !== tenantId, listByTenant filters explicitly).
  SupportRequest: 'operator reads across tenants; company side scopes manually',
};

describe('TENANT_SCOPED_MODELS stays in step with the schema', () => {
  test('every model with a tenantId column is scoped, or explicitly excused', () => {
    // A model missing from both lists fails silently in production — it simply becomes
    // readable and writable across every tenant. This is the check that catches it.
    const missing = modelsWithTenantId()
      .filter((m) => !TENANT_SCOPED_MODELS.has(m) && !(m in INTENTIONALLY_UNSCOPED));
    expect(missing).toEqual([]);
  });

  test('the excusal list does not drift out of the schema', () => {
    const withTenantId = new Set(modelsWithTenantId());
    const stale = Object.keys(INTENTIONALLY_UNSCOPED).filter((m) => !withTenantId.has(m));
    expect(stale).toEqual([]);
  });

  test('nothing is scoped that has no tenantId column to filter on', () => {
    const withTenantId = new Set(modelsWithTenantId());
    const bogus = [...TENANT_SCOPED_MODELS].filter((m) => !withTenantId.has(m));
    expect(bogus).toEqual([]);
  });
});

/** Captures the args the extension hands to the underlying query. */
function capture() {
  const seen: any[] = [];
  const fake: any = {
    $extends(ext: any) {
      const op = ext.query.$allModels.$allOperations;
      return {
        run: (model: string, operation: string, args: any) =>
          op({ model, operation, args, query: (a: any) => { seen.push(a); return a; } }),
      };
    },
  };
  return { fake, seen };
}

describe('scopedClient', () => {
  test('rejects an empty tenantId rather than scoping to nothing', () => {
    expect(() => scopedClient({} as any, '')).toThrow(/requires a tenantId/);
  });

  test('narrows reads to the tenant', async () => {
    const { fake, seen } = capture();
    const c: any = scopedClient(fake, 't1');
    await c.run('Asset', 'findMany', { where: { status: 'AVAILABLE' } });
    expect(seen[0].where).toEqual({ status: 'AVAILABLE', tenantId: 't1' });
  });

  test('stamps creates, including createMany batches', async () => {
    const { fake, seen } = capture();
    const c: any = scopedClient(fake, 't1');
    await c.run('Asset', 'create', { data: { name: 'x' } });
    await c.run('Asset', 'createMany', { data: [{ name: 'a' }, { name: 'b' }] });
    expect(seen[0].data).toEqual({ name: 'x', tenantId: 't1' });
    expect(seen[1].data).toEqual([{ name: 'a', tenantId: 't1' }, { name: 'b', tenantId: 't1' }]);
  });

  test('an update cannot re-home a row to another tenant', async () => {
    const { fake, seen } = capture();
    const c: any = scopedClient(fake, 't1');
    await c.run('Asset', 'update', { where: { id: 'a1' }, data: { tenantId: 'attacker', name: 'x' } });
    expect(seen[0].where).toEqual({ id: 'a1', tenantId: 't1' });
    expect(seen[0].data.tenantId).toBe('t1');
  });

  test('does not mutate the caller-supplied args', async () => {
    // The previous implementation stamped `args.data` in place, so a caller reusing
    // one object across tenants would leak the first tenant's id into the second call.
    const { fake } = capture();
    const c: any = scopedClient(fake, 't1');
    const args = { where: { id: 'a1' }, data: { name: 'x' } };
    await c.run('Asset', 'update', args);
    expect(args).toEqual({ where: { id: 'a1' }, data: { name: 'x' } });
  });

  test('leaves global models untouched', async () => {
    const { fake, seen } = capture();
    const c: any = scopedClient(fake, 't1');
    await c.run('PlatformUser', 'findMany', { where: { active: true } });
    expect(seen[0].where).toEqual({ active: true });
  });
});
