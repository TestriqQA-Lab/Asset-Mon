import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { PlatformAuthGuard } from './platform-auth.guard';
import { SuperAdminOnly } from './super-admin-only.decorator';
import { SuperAdminOnlyGuard } from './super-admin-only.guard';
import { PlatformAnnouncementsService } from './platform-announcements.service';

class CreateAnnouncementDto {
  @IsString() @Length(1, 140) title: string;
  @IsString() @Length(1, 2000) body: string;
  @IsIn(['info', 'warning', 'critical']) severity: string;
  @IsIn(['ALL', 'PLAN', 'TENANTS']) audienceType: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @Length(1, 128, { each: true }) audiencePlans?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @IsString({ each: true }) @Length(1, 128, { each: true }) audienceTenantIds?: string[];
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateAnnouncementDto {
  @IsOptional() @IsString() @Length(1, 140) title?: string;
  @IsOptional() @IsString() @Length(1, 2000) body?: string;
  @IsOptional() @IsIn(['info', 'warning', 'critical']) severity?: string;
  @IsOptional() @IsIn(['ALL', 'PLAN', 'TENANTS']) audienceType?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @Length(1, 128, { each: true }) audiencePlans?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @IsString({ each: true }) @Length(1, 128, { each: true }) audienceTenantIds?: string[];
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

// GET is SUPPORT-readable; create/update/delete are @SuperAdminOnly (and audited).
// The write guard is belt-and-braces on top of the service's assertSuperAdmin.
@ApiTags('platform-announcements')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, SuperAdminOnlyGuard)
@Controller('platform/announcements')
export class PlatformAnnouncementsController {
  constructor(private readonly svc: PlatformAnnouncementsService) {}

  @Get()
  list() { return this.svc.listForOperator(); }

  @Post()
  @SuperAdminOnly()
  create(@Req() req: any, @Body() dto: CreateAnnouncementDto) {
    return this.svc.create(req.platformUser, dto, req);
  }

  @Patch(':id')
  @SuperAdminOnly()
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.svc.update(req.platformUser, id, dto, req);
  }

  @Delete(':id')
  @SuperAdminOnly()
  remove(@Req() req: any, @Param('id') id: string) {
    return this.svc.remove(req.platformUser, id, req);
  }
}
