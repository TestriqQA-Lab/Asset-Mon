import { Controller, ForbiddenException, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { WorkspaceInviteService } from './workspace-invite.service';

// Service-level role enforcement so this remains correct even if the global
// RolesGuard is ever disabled for testing — invite links are sensitive enough to
// always require an admin.
function requireAdmin(user: any) {
  if (!user || user.role !== 'ADMIN') {
    throw new ForbiddenException('Only an admin can manage the workspace invite link');
  }
}

@ApiTags('workspace-invite')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('workspace-invite')
export class WorkspaceInviteController {
  constructor(private readonly svc: WorkspaceInviteService) {}

  @Get()
  @Roles('ADMIN')
  get(@CurrentUser() user: any) {
    requireAdmin(user);
    return this.svc.getOrCreate(user.tid);
  }

  @Post('rotate')
  @Roles('ADMIN')
  rotate(@CurrentUser() user: any) {
    requireAdmin(user);
    return this.svc.rotate(user.tid);
  }

  @Post('disable')
  @Roles('ADMIN')
  disable(@CurrentUser() user: any) {
    requireAdmin(user);
    return this.svc.disable(user.tid);
  }
}
