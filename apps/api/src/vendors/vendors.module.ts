import { Body, Controller, Delete, Get, Module, Param, Patch, Post, UseGuards, Injectable } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';

@Injectable()
class VendorsService {
  constructor(private readonly ctx: TenantContextService) {}
  list() { return this.ctx.prisma().vendor.findMany({ orderBy: { name: 'asc' } }); }
  create(d: any) { return this.ctx.prisma().vendor.create({ data: d }); }
  update(id: string, d: any) { return this.ctx.prisma().vendor.update({ where: { id }, data: d }); }
  remove(id: string) { return this.ctx.prisma().vendor.delete({ where: { id } }); }
}

class CreateVendorDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() contact?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
}
class UpdateVendorDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() contact?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
}

@ApiTags('vendors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('vendors')
class VendorsController {
  constructor(private readonly svc: VendorsService) {}
  @Get() @Roles('ADMIN', 'ASSET_MANAGER') list() { return this.svc.list(); }
  @Post() @Roles('ADMIN', 'ASSET_MANAGER') create(@Body() d: CreateVendorDto) { return this.svc.create(d); }
  @Patch(':id') @Roles('ADMIN', 'ASSET_MANAGER') update(@Param('id') id: string, @Body() d: UpdateVendorDto) { return this.svc.update(id, d); }
  @Delete(':id') @Roles('ADMIN') remove(@Param('id') id: string) { return this.svc.remove(id); }
}

@Module({ controllers: [VendorsController], providers: [VendorsService] })
export class VendorsModule {}
