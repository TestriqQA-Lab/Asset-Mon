import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';

const KINDS = ['assets', 'tickets', 'maintenance', 'reservations', 'audits'] as const;

@Injectable()
class SavedViewsService {
  constructor(private readonly ctx: TenantContextService) {}

  list(userId: string, kind?: string) {
    const where: any = { OR: [{ ownerId: userId }, { isShared: true }] };
    if (kind) where.kind = kind;
    return this.ctx.prisma().savedView.findMany({
      where,
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      include: { owner: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  create(userId: string, d: { name: string; kind: string; filters?: any; isShared?: boolean }) {
    return this.ctx.prisma().savedView.create({
      data: { ownerId: userId, name: d.name, kind: d.kind, filters: d.filters || {}, isShared: !!d.isShared },
    });
  }

  async update(userId: string, role: string, id: string, d: any) {
    const v = await this.ctx.prisma().savedView.findUnique({ where: { id } });
    if (!v) throw new NotFoundException();
    if (v.ownerId !== userId && role !== 'ADMIN') throw new BadRequestException('Only the owner or an admin can update this view');
    const data: any = {};
    if (d.name) data.name = d.name;
    if (d.filters) data.filters = d.filters;
    if (typeof d.isShared === 'boolean') data.isShared = d.isShared;
    return this.ctx.prisma().savedView.update({ where: { id }, data });
  }

  async remove(userId: string, role: string, id: string) {
    const v = await this.ctx.prisma().savedView.findUnique({ where: { id } });
    if (!v) return;
    if (v.ownerId !== userId && role !== 'ADMIN') throw new BadRequestException('Only the owner or an admin can delete this view');
    return this.ctx.prisma().savedView.delete({ where: { id } });
  }
}

class CreateDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsIn(KINDS as any) kind: string;
  @IsOptional() @IsObject() filters?: Record<string, any>;
  @IsOptional() @IsBoolean() isShared?: boolean;
}
class UpdateDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsObject() filters?: Record<string, any>;
  @IsOptional() @IsBoolean() isShared?: boolean;
}

@ApiTags('saved-views')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('saved-views')
class SavedViewsController {
  constructor(private readonly svc: SavedViewsService) {}

  @Get()
  list(@CurrentUser('sub') uid: string, @Query('kind') kind?: string) {
    return this.svc.list(uid, kind);
  }

  @Post()
  create(@CurrentUser('sub') uid: string, @Body() dto: CreateDto) {
    return this.svc.create(uid, dto);
  }

  @Patch(':id')
  update(@CurrentUser('sub') uid: string, @CurrentUser('role') role: string, @Param('id') id: string, @Body() dto: UpdateDto) {
    return this.svc.update(uid, role, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser('sub') uid: string, @CurrentUser('role') role: string, @Param('id') id: string) {
    return this.svc.remove(uid, role, id);
  }
}

@Module({ controllers: [SavedViewsController], providers: [SavedViewsService] })
export class SavedViewsModule {}
