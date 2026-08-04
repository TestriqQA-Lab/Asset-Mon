import { PrismaClient } from '@assetmon/db';

/**
 * Models that carry a `tenantId` column and must never be queried without one.
 *
 * Kept in sync with the schema by `scoped-client.spec.ts`, which reads Prisma's
 * DMMF and fails if any model declaring a `tenantId` field is missing here. That
 * check exists because the failure mode is silent: a new model omitted from this
 * set is simply readable and writable across every tenant.
 */
export const TENANT_SCOPED_MODELS = new Set([
  'User', 'Department', 'Location', 'Category', 'Vendor', 'Asset',
  'Assignment', 'MaintenanceSchedule', 'ServiceTicket', 'PurchaseRequest',
  'PurchaseRequestItem', 'PurchaseOrder', 'PurchaseOrderItem', 'Software',
  'SoftwareLicense', 'SoftwareAssignment', 'Reservation', 'AuditSession',
  'AuditScan', 'AssetAttachment', 'AssetStatusDef', 'SavedView', 'ApiKey',
  'Webhook', 'WebhookDelivery', 'EmailLog', 'AuditLog', 'Notification',
  'RefreshTokenJti', 'IdempotencyKey', 'TenantMfaPending', 'TenantBackupCode',
  'AssetRequest', 'AssetRequestItem', 'AuditCounter',
]);

/** Operations whose `where` must be narrowed to the tenant. */
const WHERE_OPS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany', 'update', 'delete',
]);

/** Operations whose `data` must be stamped with the tenant. */
const DATA_OPS = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert']);

export type ScopedPrismaClient = ReturnType<typeof scopedClient>;

/**
 * Wrap the shared client so every tenant-scoped model is automatically filtered
 * and stamped with `tenantId`. This is the only sanctioned way for tenant-facing
 * code to reach the database.
 *
 * Two things it deliberately does NOT do:
 *
 *  • It does not reach nested relation writes. `$allOperations` fires per top-level
 *    call, so `{ items: { create: [...] } }` never passes through here and the child
 *    rows would be written without a tenantId. Every such site has been flattened
 *    into a transaction of individual creates; keep it that way.
 *
 *  • It does not touch raw queries. `$queryRaw*`/`$executeRaw*` bypass extensions
 *    entirely and must name their tenant inline — see ci/check-raw-queries.sh.
 */
export function scopedClient(prisma: PrismaClient, tenantId: string) {
  if (!tenantId) throw new Error('scopedClient requires a tenantId');

  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) return query(args);

          // Shallow-clone rather than mutate: `args` belongs to the caller, and
          // stamping it in place corrupts any object they reuse across calls.
          const next: any = { ...((args as any) ?? {}) };

          if (WHERE_OPS.has(operation)) {
            next.where = { ...(next.where ?? {}), tenantId };
          }

          if (DATA_OPS.has(operation) && next.data != null) {
            next.data = Array.isArray(next.data)
              ? next.data.map((d: any) => ({ ...d, tenantId }))
              : { ...next.data, tenantId };
          }

          if (operation === 'upsert') {
            if (next.create) next.create = { ...next.create, tenantId };
            // Pin tenantId on the update branch too, so an upsert can never move an
            // existing row to another tenant.
            if (next.update) next.update = { ...next.update, tenantId };
          }

          // An explicit `data.tenantId` on an update would re-home the row. The
          // where-clause above already restricts which row is hit; this stops the
          // row being handed to a different tenant once found.
          if ((operation === 'update' || operation === 'updateMany') && next.data != null) {
            next.data = { ...next.data, tenantId };
          }

          return query(next);
        },
      },
    },
  });
}
