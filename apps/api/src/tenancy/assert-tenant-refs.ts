import { BadRequestException } from '@nestjs/common';

/**
 * Verify that every foreign-key id a caller supplied belongs to the caller's tenant.
 *
 * Under database-per-tenant this was free: a categoryId from another workspace simply
 * did not exist in your database, and the FK rejected it. Under shared tables the row
 * DOES exist, the FK is satisfied, and nothing else objects — so a request can create
 * its own asset pointing at another tenant's category. The row is then rendered
 * through `include: { category: true }` and the other tenant's data comes back in the
 * response.
 *
 * The check works because `db` is the tenant-scoped client: its findUnique already
 * filters by tenantId, so "not found" and "not yours" are the same answer.
 *
 * Pass model accessors as they appear on the Prisma client:
 *
 *   await assertTenantRefs(db, {
 *     category: data.categoryId,
 *     location: data.locationId,
 *     asset:    data.parentId,
 *   });
 *
 * Undefined and null values are skipped, so this can be called with a whole patch
 * object without pre-filtering.
 */
export async function assertTenantRefs(
  db: any,
  refs: Record<string, string | null | undefined>,
): Promise<void> {
  const present = Object.entries(refs).filter(([, id]) => typeof id === 'string' && id.length > 0);
  if (present.length === 0) return;

  const missing = (
    await Promise.all(
      present.map(async ([model, id]) => {
        const accessor = db[model];
        if (!accessor) throw new Error(`assertTenantRefs: no Prisma model '${model}'`);
        const row = await accessor.findUnique({ where: { id }, select: { id: true } }).catch(() => null);
        return row ? null : model;
      }),
    )
  ).filter(Boolean) as string[];

  if (missing.length > 0) {
    // Deliberately the same message whether the id is nonexistent or belongs to
    // another tenant — distinguishing them would confirm the row exists elsewhere.
    throw new BadRequestException(
      `Unknown ${missing.join(', ')} reference for this workspace`,
    );
  }
}
