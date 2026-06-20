import { Controller, Get, Injectable, Module, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { ModuleGuard } from '../tenant-settings/module.guard';
import { RequireModule } from '../tenant-settings/require-module.decorator';

type Method = 'NONE' | 'STRAIGHT_LINE' | 'DECLINING_BALANCE';

@Injectable()
class DepreciationService {
  constructor(private readonly ctx: TenantContextService) {}

  private monthsBetween(from: Date, to: Date): number {
    const m = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
    return Math.max(0, m);
  }

  compute(asset: {
    purchaseCost: any;
    salvageValue?: any;
    usefulLifeMonths?: number | null;
    depreciationStart?: Date | null;
    depreciationMethod: Method;
  }, asOf: Date = new Date()) {
    return computeDepreciation(asset as any, asOf);
  }

  async forAsset(id: string, asOf: Date = new Date()) {
    const a = await this.ctx.prisma().asset.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Asset not found');
    return this.compute(a as any, asOf);
  }

  async fleet(asOf: Date = new Date()) {
    const assets = await this.ctx.prisma().asset.findMany({
      where: { depreciationMethod: { not: 'NONE' }, purchaseCost: { not: null } },
      select: {
        id: true, assetTag: true, name: true, purchaseCost: true, salvageValue: true,
        usefulLifeMonths: true, depreciationStart: true, depreciationMethod: true,
        category: { select: { id: true, name: true } },
      },
    });
    let totalCost = 0, totalBookValue = 0, totalDepreciation = 0;
    const items = assets.map((a: any) => {
      const r = this.compute(a, asOf);
      totalCost += r.cost;
      totalBookValue += r.bookValue;
      totalDepreciation += r.accumulated;
      return { ...a, depreciation: r };
    });
    return {
      asOf: asOf.toISOString(),
      totalCost: round2(totalCost),
      totalDepreciation: round2(totalDepreciation),
      totalBookValue: round2(totalBookValue),
      items,
    };
  }

  async schedule(id: string) {
    const a = await this.ctx.prisma().asset.findUnique({ where: { id } });
    if (!a) throw new NotFoundException();
    const cost = Number(a.purchaseCost ?? 0);
    const salvage = Number(a.salvageValue ?? 0);
    // Hard cap defends against absurd `usefulLifeMonths` values pinning the event loop.
    const life = Math.min(a.usefulLifeMonths || 0, 600);
    if (a.depreciationMethod === 'NONE' || !cost || !life || !a.depreciationStart) return [];
    const start = new Date(a.depreciationStart);
    const rows = [];
    let bv = cost;
    for (let i = 1; i <= life; i++) {
      const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
      let dep = 0;
      if (a.depreciationMethod === 'STRAIGHT_LINE') {
        dep = (cost - salvage) / life;
      } else {
        const rate = 2 / life;
        dep = Math.max(0, Math.min(bv * rate, bv - salvage));
      }
      if (bv - dep < salvage) dep = bv - salvage;
      bv -= dep;
      rows.push({ month: month.toISOString().slice(0, 7), depreciation: round2(dep), bookValue: round2(bv) });
      if (bv <= salvage) break;
    }
    return rows;
  }
}

// Exported so the reports module uses one canonical formula.
export function computeDepreciation(asset: {
  purchaseCost: any; salvageValue?: any; usefulLifeMonths?: number | null;
  depreciationStart?: Date | null; depreciationMethod: any;
}, asOf: Date = new Date()) {
  const method = asset.depreciationMethod;
  const cost = Number(asset.purchaseCost ?? 0);
  const salvage = Number(asset.salvageValue ?? 0);
  const life = Math.min(asset.usefulLifeMonths || 0, 600);
  const start = asset.depreciationStart ? new Date(asset.depreciationStart) : null;
  if (method === 'NONE' || !cost || !life || !start) {
    return { method, cost, salvage, usefulLifeMonths: life, monthsElapsed: 0, accumulated: 0, bookValue: cost, fullyDepreciated: false };
  }
  const monthsBetween = Math.max(0, (asOf.getUTCFullYear() - start.getUTCFullYear()) * 12 + (asOf.getUTCMonth() - start.getUTCMonth()));
  const monthsElapsed = Math.min(monthsBetween, life);
  let accumulated = 0;
  if (method === 'STRAIGHT_LINE') {
    accumulated = ((cost - salvage) / life) * monthsElapsed;
  } else {
    const rate = 2 / life;
    let bv = cost;
    for (let i = 0; i < monthsElapsed; i++) {
      const dep = Math.max(0, Math.min(bv * rate, bv - salvage));
      bv -= dep;
      if (bv <= salvage) { bv = salvage; break; }
    }
    accumulated = cost - bv;
  }
  accumulated = Math.min(accumulated, cost - salvage);
  const bookValue = Math.max(salvage, cost - accumulated);
  return {
    method, cost, salvage, usefulLifeMonths: life,
    monthsElapsed, accumulated: round2(accumulated), bookValue: round2(bookValue),
    fullyDepreciated: monthsElapsed >= life,
  };
}

function round2(n: number) { return Math.round(n * 100) / 100; }

@ApiTags('depreciation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ModuleGuard, RolesGuard)
@RequireModule('depreciation')
// Asset book values / accumulated depreciation are finance data; lock to manager+.
@Roles('ADMIN', 'ASSET_MANAGER')
@Controller('depreciation')
class DepreciationController {
  constructor(private readonly svc: DepreciationService) {}

  @Get('fleet')
  fleet(@Query('asOf') asOf?: string) {
    return this.svc.fleet(asOf ? new Date(asOf) : new Date());
  }

  @Get(':id')
  forAsset(@Param('id') id: string, @Query('asOf') asOf?: string) {
    return this.svc.forAsset(id, asOf ? new Date(asOf) : new Date());
  }

  @Get(':id/schedule')
  schedule(@Param('id') id: string) {
    return this.svc.schedule(id);
  }
}

@Module({ controllers: [DepreciationController], providers: [DepreciationService] })
export class DepreciationModule {}
