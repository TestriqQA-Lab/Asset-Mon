import { ConflictException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../tenancy/tenant-context.service';

export type CustomField = { name: string; type: 'text' | 'number' | 'date' | 'boolean'; required?: boolean };
export type CategoryType = 'ASSET' | 'ACCESSORY' | 'LICENSE';

type CategoryWrite = {
  name?: string;
  description?: string;
  customFields?: CustomField[];
  type?: CategoryType;
  imageUrl?: string | null;
};

@Injectable()
export class CategoriesService {
  constructor(private readonly ctx: TenantContextService) {}

  /** List categories with a LIVE count of assets in each (self-updating "quantity"). */
  async list() {
    const db = this.ctx.prisma();
    const [cats, counts] = await Promise.all([
      db.category.findMany({ orderBy: { name: 'asc' } }),
      db.asset.groupBy({ by: ['categoryId'], _count: { _all: true } }),
    ]);
    const countMap = new Map<string, number>(
      counts.filter((c: any) => c.categoryId).map((c: any) => [c.categoryId, c._count._all]),
    );
    return cats.map((c) => ({ ...c, assetCount: countMap.get(c.id) || 0 }));
  }

  get(id: string) {
    return this.ctx.prisma().category.findUnique({ where: { id } });
  }

  create(data: CategoryWrite & { name: string }) {
    return this.ctx.prisma().category.create({
      data: {
        name: data.name,
        description: data.description,
        customFields: data.customFields || [],
        type: (data.type as any) || 'ASSET',
        imageUrl: data.imageUrl ?? null,
      },
    });
  }

  update(id: string, data: CategoryWrite) {
    // Undefined fields are ignored by Prisma; `imageUrl: null` explicitly clears the image.
    return this.ctx.prisma().category.update({ where: { id }, data: data as any });
  }

  async remove(id: string) {
    const db = this.ctx.prisma();
    const [assetCount, prItemCount, poItemCount] = await Promise.all([
      db.asset.count({ where: { categoryId: id } }),
      db.purchaseRequestItem.count({ where: { categoryId: id } }),
      db.purchaseOrderItem.count({ where: { categoryId: id } }),
    ]);
    if (assetCount + prItemCount + poItemCount > 0) {
      const parts = [];
      if (assetCount) parts.push(`${assetCount} asset(s)`);
      if (prItemCount) parts.push(`${prItemCount} purchase-request item(s)`);
      if (poItemCount) parts.push(`${poItemCount} purchase-order item(s)`);
      throw new ConflictException(`Category is in use by ${parts.join(', ')}. Reassign them first.`);
    }
    return db.category.delete({ where: { id } });
  }
}
