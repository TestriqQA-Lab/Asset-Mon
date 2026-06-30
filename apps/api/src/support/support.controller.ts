import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupportService } from './support.service';

class CreateRequestDto {
  @IsString() @MinLength(1) @MaxLength(150) subject: string;
  @IsString() @MinLength(1) @MaxLength(5000) body: string;
}
class AddMessageDto {
  @IsString() @MinLength(1) @MaxLength(5000) body: string;
}

// Company-admin-only. Every route is scoped to the caller's tenant id.
@ApiTags('support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('support')
export class SupportController {
  constructor(private readonly svc: SupportService) {}

  // NB: 'unread-count' is declared before ':id' so it isn't captured by the param route.
  @Get('unread-count')
  unread(@CurrentUser('tid') tid: string) { return this.svc.tenantUnreadCount(tid); }

  @Get()
  list(@CurrentUser('tid') tid: string) { return this.svc.listByTenant(tid); }

  @Get(':id')
  get(@CurrentUser('tid') tid: string, @Param('id') id: string) { return this.svc.getForTenant(tid, id); }

  @Post()
  create(
    @CurrentUser('tid') tid: string,
    @CurrentUser('email') email: string,
    @CurrentUser('sub') sub: string,
    @Body() dto: CreateRequestDto,
  ) {
    return this.svc.create(tid, email, sub, dto.subject, dto.body);
  }

  @Post(':id/messages')
  addMessage(
    @CurrentUser('tid') tid: string,
    @CurrentUser('email') email: string,
    @Param('id') id: string,
    @Body() dto: AddMessageDto,
  ) {
    return this.svc.addTenantMessage(tid, id, email, dto.body);
  }
}
