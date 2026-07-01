import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAnnouncementsService } from '../platform/platform-announcements.service';

// Tenant-facing read of broadcast announcements. Any authenticated tenant user
// (all roles) may see the notices that target their workspace. The tenant id +
// plan are taken from the verified JWT (req.tenant), never from the client, so a
// tenant can only ever receive its own matching announcements.
@ApiTags('announcements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly svc: PlatformAnnouncementsService) {}

  @Get()
  active(@Req() req: any) {
    return this.svc.activeForTenant({ id: req.tenant.id, plan: req.tenant.plan });
  }
}
