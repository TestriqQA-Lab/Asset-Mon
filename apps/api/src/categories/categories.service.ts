import { ConflictException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../tenancy/tenant-context.service';

export type CustomField = { name: string; type: 'text' | 'number' | 'date' | 'boolean'; required?: boolean };

@Injectable()
export class CategoriesService {
  constructor(private readonly ctx: TenantContextService) {}

  list() {
    return this.ctx.prisma().category.findMany({ orderBy: { name: 'asc' } });
  }
  get(id: string) {
    return this.ctx.prisma().category.findUnique({ where: { id } });
  }
  create(data: { name: string; description?: string; customFields?: CustomField[] }) {
    return this.ctx.prisma().category.create({
      data: { name: data.name, description: data.description, customFields: data.customFields || [] },
    });
  }
  update(id: string, data: { name?: string; description?: string; customFields?: CustomField[] }) {
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
