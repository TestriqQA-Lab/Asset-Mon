import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException,
  Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { IsEnum, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { assertTenantRefs } from '../tenancy/assert-tenant-refs';
import { ModuleGuard } from '../tenant-settings/module.guard';
import { RequireModule } from '../tenant-settings/require-module.decorator';
import { NavPermissionsGuard } from '../tenant-settings/nav-permissions.guard';
import { RequireNav } from '../tenant-settings/require-nav.decorator';
import { writeAuditEntry } from '../common/audit-hash';

const LICENSE_TYPES = ['PERPETUAL', 'SUBSCRIPTION', 'TRIAL', 'OPEN_SOURCE'] as const;

@Injectable()
class SoftwareService {
  constructor(private readonly ctx: TenantContextService) {}

  list() {
    return this.ctx.prisma().software.findMany({
      orderBy: { name: 'asc' },
      include: { licenses: { select: { id: true, seats: true, expiresAt: true, type: true } } },
    });
  }

  get(id: string) {
    return this.ctx.prisma().software.findUnique({
      where: { id },
      include: {
        licenses: {
          orderBy: { createdAt: 'desc' },
          include: {
            assignments: { where: { returnedAt: null }, select: { id: true } },
            vendor: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  create(d: any) {
    return this.ctx.prisma().software.create({
      data: { tenantId: this.ctx.tenantId!, name: d.name, publisher: d.publisher || null, description: d.description || null },
    });
  }

  update(id: string, d: any) {
    return this.ctx.prisma().software.update({ where: { id }, data: d });
  }

  remove(id: string) {
    return this.ctx.prisma().software.delete({ where: { id } });
  }
}

@Injectable()
class LicensesService {
  constructor(private readonly ctx: TenantContextService) {}

  list(filter: { softwareId?: string; expiringInDays?: number }) {
    const where: any = {};
    if (filter.softwareId) where.softwareId = filter.softwareId;
    if (filter.expiringInDays) {
      // Match the dashboard's "expiring soon" definition: still in the future, but
      // expiring within the window. Already-expired rows are surfaced via a separate
      // filter (`expired=1`) below.
      const now = new Date();
      where.expiresAt = {
        not: null,
        gte: now,
        lte: new Date(now.getTime() + filter.expiringInDays * 86_400_000),
      };
    }
    if ((filter as any).expired === true || (filter as any).expired === 'true' || (filter as any).expired === '1') {
      where.expiresAt = { not: null, lt: new Date() };
    }
    return this.ctx.prisma().softwareLicense.findMany({
      where,
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'desc' }],
      include: {
        software: { select: { id: true, name: true, publisher: true } },
        vendor: { select: { id: true, name: true } },
        assignments: { where: { returnedAt: null }, select: { id: true } },
      },
    });
  }

  get(id: string) {
    return this.ctx.prisma().softwareLicense.findUnique({
      where: { id },
      include: {
        software: true,
        vendor: true,
        assignments: {
          orderBy: { assignedAt: 'desc' },
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
            asset: { select: { id: true, assetTag: true, name: true } },
          },
        },
      },
    });
  }

  async create(d: any) {
    await assertTenantRefs(this.ctx.prisma(), { software: d.softwareId, vendor: d.vendorId });
    return this.ctx.prisma().softwareLicense.create({
      data: {
        tenantId: this.ctx.tenantId!,
        softwareId: d.softwareId,
        licenseKey: d.licenseKey || null,
        type: d.type || 'SUBSCRIPTION',
        seats: d.seats ?? 1,
        purchaseDate: d.purchaseDate ? new Date(d.purchaseDate) : null,
        expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
        cost: d.cost ?? null,
        vendorId: d.vendorId || null,
        notes: d.notes || null,
      },
    });
  }

  update(id: string, d: any) {
    const patch: any = { ...d };
    if (d.purchaseDate !== undefined) patch.purchaseDate = d.purchaseDate ? new Date(d.purchaseDate) : null;
    if (d.expiresAt !== undefined) patch.expiresAt = d.expiresAt ? new Date(d.expiresAt) : null;
    if (d.vendorId !== undefined) patch.vendorId = d.vendorId || null;
    if (d.cost === '') patch.cost = null;
    return this.ctx.prisma().softwareLicense.update({ where: { id }, data: patch });
  }

  remove(id: string) {
    return this.ctx.prisma().softwareLicense.delete({ where: { id } });
  }

  async assign(licenseId: string, body: { userId?: string; assetId?: string; notes?: string }, performedById: string) {
    if (!body.userId && !body.assetId) throw new BadRequestException('Either userId or assetId is required');
    const db = this.ctx.prisma();

    // Verify the supplied user/asset actually exists in the *current* tenant before
    // we attempt to attach the assignment; surfaces a clean 404 instead of P2003.
    if (body.userId) {
      const u = await db.user.findUnique({ where: { id: body.userId }, select: { id: true } });
      if (!u) throw new NotFoundException('User not found in this workspace');
    }
    if (body.assetId) {
      const a = await db.asset.findUnique({ where: { id: body.assetId }, select: { id: true } });
      if (!a) throw new NotFoundException('Asset not found in this workspace');
    }

    // Serialise the seat check + insert with row-level locking so two concurrent
    // assigns can never both commit and over-allocate a license.
    // FOR UPDATE on the license row prevents concurrent reads of the same seat count.
    const result = await db.$transaction(async (tx: any) => {
      // Lock the license row to prevent concurrent seat allocation races.
      // MySQL syntax: backtick identifiers and `?` placeholders — double quotes are
      // string literals here, not identifiers, and `$1` is a syntax error.
      await tx.$queryRawUnsafe(
        `SELECT \`id\` FROM \`SoftwareLicense\` WHERE \`id\` = ? FOR UPDATE`,
        licenseId,
      );
      const lic = await tx.softwareLicense.findUnique({
        where: { id: licenseId },
        include: { assignments: { where: { returnedAt: null } } },
      });
      if (!lic) throw new NotFoundException();
      if (lic.assignments.length >= lic.seats) {
        throw new BadRequestException(`License is at seat capacity (${lic.seats}/${lic.seats}).`);
      }
      const dup = await tx.softwareAssignment.findFirst({
        where: {
          licenseId, returnedAt: null,
          ...(body.userId ? { userId: body.userId } : { assetId: body.assetId }),
        },
      });
      if (dup) throw new BadRequestException('This user/asset already has this license');
      return tx.softwareAssignment.create({
        data: {
          licenseId,
          userId: body.userId || null,
          assetId: body.assetId || null,
          notes: body.notes || null,
        },
      });
    }, { isolationLevel: 'ReadCommitted' as any });

    await writeAuditEntry(db, {
      tenantId: this.ctx.tenantId!,
      assetId: body.assetId || null, action: 'LICENSE_ASSIGNED', performedById,
      detail: { licenseId, assignmentId: result.id, userId: body.userId, assetId: body.assetId },
    });
    return result;
  }

  async unassign(licenseId: string, assignmentId: string, performedById: string) {
    const db = this.ctx.prisma();
    const a = await db.softwareAssignment.findFirst({ where: { id: assignmentId, licenseId } });
    if (!a) throw new NotFoundException();
    if (a.returnedAt) throw new BadRequestException('Already unassigned');
    const updated = await db.softwareAssignment.update({
      where: { id: assignmentId },
      data: { returnedAt: new Date() },
    });
    await writeAuditEntry(db, {
      tenantId: this.ctx.tenantId!,
      assetId: a.assetId, action: 'LICENSE_UNASSIGNED', performedById, detail: { licenseId, assignmentId },
    });
    return updated;
  }

  async compliance() {
    const db = this.ctx.prisma();
    const rows = await db.softwareLicense.findMany({
      include: {
        software: { select: { id: true, name: true } },
        assignments: { where: { returnedAt: null }, select: { id: true } },
      },
    });
    return rows.map((l: any) => ({
      id: l.id,
      software: l.software,
      type: l.type,
      seats: l.seats,
      used: l.assignments.length,
      free: Math.max(0, l.seats - l.assignments.length),
      overDeployed: l.assignments.length > l.seats,
      expiresAt: l.expiresAt,
    }));
  }
}

// ------------ DTOs ------------
class CreateSoftwareDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() publisher?: string;
  @IsOptional() @IsString() description?: string;
}
class UpdateSoftwareDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() publisher?: string;
  @IsOptional() @IsString() description?: string;
}
class CreateLicenseDto {
  @IsString() softwareId: string;
  @IsOptional() @IsString() licenseKey?: string;
  @IsOptional() @IsEnum(LICENSE_TYPES) type?: typeof LICENSE_TYPES[number];
  @IsInt() @Min(1) seats: number;
  @IsOptional() @IsISO8601() purchaseDate?: string;
  @IsOptional() @IsISO8601() expiresAt?: string;
  @IsOptional() @IsNumber() cost?: number;
  @IsOptional() @IsString() vendorId?: string;
  @IsOptional() @IsString() notes?: string;
}
class UpdateLicenseDto {
  @IsOptional() @IsString() licenseKey?: string;
  @IsOptional() @IsEnum(LICENSE_TYPES) type?: typeof LICENSE_TYPES[number];
  @IsOptional() @IsInt() @Min(0) seats?: number;
  @IsOptional() @IsISO8601() purchaseDate?: string;
  @IsOptional() @IsISO8601() expiresAt?: string;
  @IsOptional() @IsNumber() cost?: number;
  @IsOptional() @IsString() vendorId?: string;
  @IsOptional() @IsString() notes?: string;
}
class AssignDto {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() assetId?: string;
  @IsOptional() @IsString() notes?: string;
}

// ------------ Controllers ------------
@ApiTags('software')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ModuleGuard, RolesGuard, NavPermissionsGuard)
@RequireModule('software')
@RequireNav('software')
// Software inventory is operational data; EMPLOYEE has no nav for it. Lock all
// reads + writes to manager+ as a defence in depth in case a tenant flips the
// software nav on for everyone.
@Roles('ADMIN', 'ASSET_MANAGER')
@Controller('software')
class SoftwareController {
  constructor(private readonly svc: SoftwareService) {}
  @Get() list() { return this.svc.list(); }
  @Get(':id') get(@Param('id') id: string) { return this.svc.get(id); }
  @Post() create(@Body() d: CreateSoftwareDto) { return this.svc.create(d); }
  @Patch(':id') update(@Param('id') id: string, @Body() d: UpdateSoftwareDto) { return this.svc.update(id, d); }
  // Destructive: ADMIN only — overrides the class-level @Roles.
  @Delete(':id') @Roles('ADMIN') remove(@Param('id') id: string) { return this.svc.remove(id); }
}

@ApiTags('licenses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ModuleGuard, RolesGuard, NavPermissionsGuard)
@RequireModule('software')
@RequireNav('licenses')
// License records expose license keys + cost. Same manager+ lock as /software.
@Roles('ADMIN', 'ASSET_MANAGER')
@Controller('licenses')
class LicensesController {
  constructor(private readonly svc: LicensesService) {}

  @Get()
  list(
    @Query('softwareId') softwareId?: string,
    @Query('expiringInDays') expiringInDays?: string,
    @Query('expired') expired?: string,
  ) {
    return this.svc.list({
      softwareId,
      expiringInDays: expiringInDays ? Number(expiringInDays) : undefined,
      ...(expired ? { expired } as any : {}),
    });
  }

  @Get('compliance')
  compliance() { return this.svc.compliance(); }

  @Get(':id')
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  create(@Body() d: CreateLicenseDto) { return this.svc.create(d); }

  @Patch(':id')
  update(@Param('id') id: string, @Body() d: UpdateLicenseDto) { return this.svc.update(id, d); }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) { return this.svc.remove(id); }

  @Post(':id/assign')
  assign(@Param('id') id: string, @Body() d: AssignDto, @CurrentUser('sub') uid: string) {
    return this.svc.assign(id, d, uid);
  }

  @Post(':id/unassign/:assignmentId')
  unassign(@Param('id') id: string, @Param('assignmentId') aid: string, @CurrentUser('sub') uid: string) {
    return this.svc.unassign(id, aid, uid);
  }
}

@Module({
  controllers: [SoftwareController, LicensesController],
  providers: [SoftwareService, LicensesService],
})
export class SoftwareModule {}
