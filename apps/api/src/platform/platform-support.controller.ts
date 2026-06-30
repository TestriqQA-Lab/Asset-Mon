import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { PlatformAuthGuard } from './platform-auth.guard';
import { SuperAdminOnly } from './super-admin-only.decorator';
import { SuperAdminOnlyGuard } from './super-admin-only.guard';
import { PlatformSupportService } from './platform-support.service';

class ReplyDto {
  @IsString() @MinLength(1) @MaxLength(5000) body: string;
}
class StatusDto {
  @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED']) status: string;
}

// GET routes are SUPPORT-readable; reply/status are @SuperAdminOnly (and audited).
@ApiTags('platform-support')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, SuperAdminOnlyGuard)
@Controller('platform/support')
export class PlatformSupportController {
  constructor(private readonly svc: PlatformSupportService) {}

  @Get('unread-count')
  unread() { return this.svc.unreadCount(); }

  @Get()
  list(@Query('status') status?: string) { return this.svc.list({ status }); }

  @Get(':id')
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post(':id/reply')
  @SuperAdminOnly()
  reply(@Req() req: any, @Param('id') id: string, @Body() dto: ReplyDto) {
    return this.svc.reply(req.platformUser, id, dto.body, req);
  }

  @Patch(':id/status')
  @SuperAdminOnly()
  setStatus(@Req() req: any, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.svc.setStatus(req.platformUser, id, dto.status, req);
  }
}
