import { ConflictException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../tenancy/tenant-context.service';

@Injectable()
export class DepartmentsService {
  constructor(private readonly ctx: TenantContextService) {}

  list() {
    return this.ctx.prisma().department.findMany({ orderBy: { name: 'asc' } });
  }
  create(data: { name: string; costCenter?: string }) {
    return this.ctx.prisma().department.create({ data });
  }
  update(id: string, data: { name?: string; costCenter?: string }) {
    return this.ctx.prisma().department.update({ where: { id }, data });
  }
  async remove(id: string) {
    const db = this.ctx.prisma();
    const [assetCount, userCount, scopedUserCount, prCount] = await Promise.all([
      db.asset.count({ where: { departmentId: id } }),
      db.user.count({ where: { departmentId: id } }),
      db.user.count({ where: { scopedDepartmentId: id } }),
      db.purchaseRequest.count({ where: { departmentId: id } }),
    ]);
    const total = assetCount + userCount + scopedUserCount + prCount;
    if (total > 0) {
      const parts = [];
      if (assetCount) parts.push(`${assetCount} asset(s)`);
      if (userCount) parts.push(`${userCount} user(s)`);
      if (scopedUserCount) parts.push(`${scopedUserCount} scoped user(s)`);
      if (prCount) parts.push(`${prCount} purchase request(s)`);
      throw new ConflictException(`Department is in use by ${parts.join(', ')}. Reassign them first.`);
    }
    return db.department.delete({ where: { id } });
  }
}
