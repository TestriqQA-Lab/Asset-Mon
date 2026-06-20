import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException,
  Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { ModuleGuard } from '../tenant-settings/module.guard';
import { RequireModule } from '../tenant-settings/require-module.decorator';

@Injectable()
class PhysicalAuditsService {
  constructor(private readonly ctx: TenantContextService) {}

  list() {
    return this.ctx.prisma().auditSession.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        startedBy: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { scans: true } },
      },
    });
  }

  async get(id: string) {
    const db = this.ctx.prisma();
    const session = await db.auditSession.findUnique({
      where: { id },
      include: {
        startedBy: { select: { id: true, firstName: true, lastName: true } },
        scans: {
          orderBy: { createdAt: 'desc' },
          include: {
            asset: { select: { id: true, assetTag: true, name: true } },
            scannedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!session) throw new NotFoundException();
    return session;
  }

  async create(data: { name: string; scope?: any; scheduledAt?: string }) {
    return this.ctx.prisma().auditSession.create({
      data: {
        name: data.name,
        scope: data.scope || {},
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
        status: 'PLANNED',
      },
    });
  }

  async start(id: string, performedById: string) {
    const db = this.ctx.prisma();
    const s = await db.auditSession.findUnique({ where: { id } });
    if (!s) throw new NotFoundException();
    if (s.status !== 'PLANNED') throw new BadRequestException(`Cannot start from ${s.status}`);
    return db.auditSession.update({
      where: { id },
      data: { status: 'IN_PROGRESS', startedAt: new Date(), startedById: performedById },
    });
  }

  async scan(id: string, body: { assetTag?: string; assetId?: string; notes?: string }, performedById: string) {
    const db = this.ctx.prisma();
    const s = await db.auditSession.findUnique({ where: { id } });
    if (!s) throw new NotFoundException();
    if (s.status !== 'IN_PROGRESS') throw new BadRequestException('Session must be IN_PROGRESS');

    let assetId = body.assetId || null;
    if (!assetId && body.assetTag) {
      // The QR payload from /assets/:id/qr is JSON {t:'assetmon',tag,id}; accept either raw tag or JSON.
      const tag = body.assetTag.trim();
      let parsed: any = null;
      if (tag.startsWith('{')) {
        try { parsed = JSON.parse(tag); } catch {}
      }
      const lookupTag = parsed?.tag || tag;
      const a = await db.asset.findUnique({ where: { assetTag: lookupTag } });
      if (a) assetId = a.id;
    }

    // Postgres unique indexes treat NULLs as distinct, so the (sessionId, assetId)
    // constraint does NOT prevent duplicate unmatched scans of the same raw tag.
    // Do a manual de-dup in code before insert so a barcode spam doesn't inflate
    // the discrepancies count.
    if (!assetId && body.assetTag) {
      const already = await db.auditScan.findFirst({
        where: { sessionId: id, assetId: null, rawTag: body.assetTag.trim() },
      });
      if (already) return already;
    }

    try {
      return await db.auditScan.create({
        data: {
          sessionId: id,
          assetId,
          rawTag: assetId ? null : ((body.assetTag || '').trim() || null),
          scannedById: performedById,
          notes: body.notes || null,
        },
        include: { asset: { select: { id: true, assetTag: true, name: true } } },
      });
    } catch (e: any) {
      if (e.code === 'P2002') throw new BadRequestException('This asset was already scanned for this session');
      throw e;
    }
  }

  async complete(id: string) {
    const db = this.ctx.prisma();
    const s = await db.auditSession.findUnique({ where: { id } });
    if (!s) throw new NotFoundException();
    if (s.status !== 'IN_PROGRESS') throw new BadRequestException('Session must be IN_PROGRESS');
    return db.auditSession.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  }

  async cancel(id: string) {
    const db = this.ctx.prisma();
    const s = await db.auditSession.findUnique({ where: { id } });
    if (!s) throw new NotFoundException();
    if (s.status === 'COMPLETED') throw new BadRequestException('Already completed');
    return db.auditSession.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  async discrepancies(id: string) {
    const db = this.ctx.prisma();
    const s = await db.auditSession.findUnique({ where: { id }, include: { scans: true } });
    if (!s) throw new NotFoundException();
    const scope = (s.scope || {}) as { locationId?: string; departmentId?: string; categoryId?: string };
    const where: any = { status: { notIn: ['RETIRED', 'LOST'] } };
    if (scope.locationId) where.locationId = scope.locationId;
    if (scope.departmentId) where.departmentId = scope.departmentId;
    if (scope.categoryId) where.categoryId = scope.categoryId;

    const expected = await db.asset.findMany({
      where,
      select: { id: true, assetTag: true, name: true, status: true },
    });
    const scannedIds = new Set(s.scans.filter((sc: any) => sc.assetId).map((sc: any) => sc.assetId));
    const expectedIds = new Set(expected.map((a) => a.id));
    const missing = expected.filter((a) => !scannedIds.has(a.id));
    const unexpected = s.scans.filter((sc: any) => sc.assetId && !expectedIds.has(sc.assetId));
    const unmatched = s.scans.filter((sc: any) => !sc.assetId);

    return {
      expected: expected.length,
      scanned: scannedIds.size,
      missing,
      unexpected, // scanned but outside scope
      unmatched,  // raw tags that didn't resolve
    };
  }

  remove(id: string) {
    return this.ctx.prisma().auditSession.delete({ where: { id } });
  }
}

class CreateSessionDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() scope?: { locationId?: string; departmentId?: string; categoryId?: string };
  @IsOptional() @IsISO8601() scheduledAt?: string;
}
class ScanDto {
  @IsOptional() @IsString() assetTag?: string;
  @IsOptional() @IsString() assetId?: string;
  @IsOptional() @IsString() notes?: string;
}

@ApiTags('audit-sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ModuleGuard, RolesGuard)
@RequireModule('audits')
@Controller('audit-sessions')
class PhysicalAuditsController {
  constructor(private readonly svc: PhysicalAuditsService) {}

  @Get() @Roles('ADMIN', 'ASSET_MANAGER') list() { return this.svc.list(); }
  @Get(':id') @Roles('ADMIN', 'ASSET_MANAGER') get(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  @Roles('ADMIN', 'ASSET_MANAGER')
  create(@Body() dto: CreateSessionDto) { return this.svc.create(dto); }

  @Post(':id/start')
  @Roles('ADMIN', 'ASSET_MANAGER')
  start(@Param('id') id: string, @CurrentUser('sub') uid: string) { return this.svc.start(id, uid); }

  @Post(':id/scan')
  @Roles('ADMIN', 'ASSET_MANAGER')
  scan(@Param('id') id: string, @Body() dto: ScanDto, @CurrentUser('sub') uid: string) {
    return this.svc.scan(id, dto, uid);
  }

  @Post(':id/complete')
  @Roles('ADMIN', 'ASSET_MANAGER')
  complete(@Param('id') id: string) { return this.svc.complete(id); }

  @Post(':id/cancel')
  @Roles('ADMIN', 'ASSET_MANAGER')
  cancel(@Param('id') id: string) { return this.svc.cancel(id); }

  @Get(':id/discrepancies')
  @Roles('ADMIN', 'ASSET_MANAGER')
  discrepancies(@Param('id') id: string) { return this.svc.discrepancies(id); }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}

@Module({ controllers: [PhysicalAuditsController], providers: [PhysicalAuditsService] })
export class PhysicalAuditsModule {}
