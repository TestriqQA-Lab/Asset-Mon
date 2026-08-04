import { ConflictException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../tenancy/tenant-context.service';

@Injectable()
export class LocationsService {
  constructor(private readonly ctx: TenantContextService) {}

  list() {
    return this.ctx.prisma().location.findMany({ orderBy: { name: 'asc' } });
  }
  tree() {
    return this.ctx.prisma().location.findMany({ orderBy: { name: 'asc' }, include: { children: true } });
  }
  create(data: { name: string; type: any; parentId?: string | null }) {
    return this.ctx.prisma().location.create({ data: { ...data, tenantId: this.ctx.tenantId! } });
  }
  update(id: string, data: { name?: string; type?: any; parentId?: string | null }) {
    return this.ctx.prisma().location.update({ where: { id }, data });
  }
  async remove(id: string) {
    const db = this.ctx.prisma();
    const [assetCount, childCount] = await Promise.all([
      db.asset.count({ where: { locationId: id } }),
      db.location.count({ where: { parentId: id } }),
    ]);
    if (assetCount + childCount > 0) {
      const parts = [];
      if (assetCount) parts.push(`${assetCount} asset(s)`);
      if (childCount) parts.push(`${childCount} child location(s)`);
      throw new ConflictException(`Location is in use by ${parts.join(', ')}. Reassign them first.`);
    }
    return db.location.delete({ where: { id } });
  }
}
