import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { IsHexColor, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';

const SYSTEM_STATUSES = ['PENDING', 'AVAILABLE', 'ASSIGNED', 'OUT_OF_SERVICE', 'OUT_FOR_REPAIR', 'LOST_STOLEN', 'ARCHIVED'] as const;
const SYSTEM_COLOR: Record<string, string> = {
  PENDING: 'amber', AVAILABLE: 'green', ASSIGNED: 'blue', OUT_OF_SERVICE: 'red', OUT_FOR_REPAIR: 'amber', LOST_STOLEN: 'red', ARCHIVED: 'gray',
};

const LABEL_OVERRIDE: Record<string, string> = { LOST_STOLEN: 'Lost/Stolen' };
export const SYSTEM_DEFS = SYSTEM_STATUSES.map((s, i) => ({
  key: s, label: LABEL_OVERRIDE[s] || s.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
  color: SYSTEM_COLOR[s], mapsTo: s, isSystem: true, order: i,
}));

@Injectable()
export class AssetStatusDefsService {
  constructor(private readonly ctx: TenantContextService) {}

  list() {
    return this.ctx.prisma().assetStatusDef.findMany({ orderBy: { order: 'asc' } });
  }

  async ensureSeeded() {
    const db = this.ctx.prisma();
    const existing = await db.assetStatusDef.findMany({ where: { isSystem: true } });

    // Rename map for legacy keys → new keys
    const RENAME: Record<string, string> = {
      IN_STOCK: 'AVAILABLE', IN_REPAIR: 'OUT_OF_SERVICE', RETIRED: 'ARCHIVED', LOST: 'LOST_STOLEN',
    };

    // Rename any old-keyed rows to the new key
    for (const row of existing) {
      const newKey = RENAME[row.key];
      if (newKey) {
        const target = SYSTEM_DEFS.find((d) => d.key === newKey);
        if (target) {
          await db.assetStatusDef.update({
            where: { id: row.id },
            data: { key: target.key, label: target.label, color: target.color, mapsTo: target.mapsTo, order: target.order },
          }).catch(() => {});
        }
      }
    }

    // Insert any MISSING system defs, but never touch existing rows — admins are
    // allowed to re-label / re-colour / re-order the built-in statuses (see update()
    // and the Settings→Statuses page), and an unconditional update here would revert
    // those customisations on every list request.
    for (const d of SYSTEM_DEFS) {
      await db.assetStatusDef.upsert({
        where: { key: d.key },
        update: {},
        create: { ...d } as any,
      }).catch(() => {});
    }
  }

  async create(d: { key: string; label: string; color?: string; mapsTo: string; order?: number }) {
    if (!SYSTEM_STATUSES.includes(d.mapsTo as any)) throw new BadRequestException('mapsTo must be a system status');
    const key = d.key.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
    if (!key) throw new BadRequestException('Invalid key');
    return this.ctx.prisma().assetStatusDef.create({
      data: { key, label: d.label, color: d.color || 'gray', mapsTo: d.mapsTo as any, order: d.order ?? 99 },
    });
  }

  async update(id: string, d: { label?: string; color?: string; order?: number; mapsTo?: string }) {
    const existing = await this.ctx.prisma().assetStatusDef.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('Not found');
    // Locked: system defs can be re-labelled and re-coloured but not remapped.
    const data: any = {};
    if (d.label) data.label = d.label;
    if (d.color) data.color = d.color;
    if (typeof d.order === 'number') data.order = d.order;
    if (d.mapsTo && !existing.isSystem) {
      if (!SYSTEM_STATUSES.includes(d.mapsTo as any)) throw new BadRequestException('mapsTo must be a system status');
      data.mapsTo = d.mapsTo;
    }
    return this.ctx.prisma().assetStatusDef.update({ where: { id }, data });
  }

  async remove(id: string) {
    const existing = await this.ctx.prisma().assetStatusDef.findUnique({ where: { id } });
    if (!existing) return;
    if (existing.isSystem) throw new BadRequestException('Cannot delete a system status');
    return this.ctx.prisma().assetStatusDef.delete({ where: { id } });
  }
}

class CreateDto {
  @IsString() @MinLength(1) @MaxLength(40) @Matches(/^[A-Za-z][A-Za-z0-9_ ]*$/) key: string;
  @IsString() @MinLength(1) @MaxLength(40) label: string;
  @IsOptional() @IsString() @MaxLength(20) color?: string;
  @IsIn(SYSTEM_STATUSES as any) mapsTo: string;
  @IsOptional() @IsInt() @Min(0) order?: number;
}
class UpdateDto {
  @IsOptional() @IsString() @MaxLength(40) label?: string;
  @IsOptional() @IsString() @MaxLength(20) color?: string;
  @IsOptional() @IsInt() @Min(0) order?: number;
  @IsOptional() @IsIn(SYSTEM_STATUSES as any) mapsTo?: string;
}

@ApiTags('asset-status-defs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('asset-status-defs')
class StatusDefsController {
  constructor(private readonly svc: AssetStatusDefsService) {}

  @Get()
  async list() {
    await this.svc.ensureSeeded();
    return this.svc.list();
  }

  @Post() @Roles('ADMIN', 'ASSET_MANAGER')
  create(@Body() dto: CreateDto) { return this.svc.create(dto); }

  @Patch(':id') @Roles('ADMIN', 'ASSET_MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateDto) { return this.svc.update(id, dto); }

  @Delete(':id') @Roles('ADMIN')
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}

@Module({
  controllers: [StatusDefsController],
  providers: [AssetStatusDefsService],
  exports: [AssetStatusDefsService],
})
export class AssetStatusDefsModule {}
