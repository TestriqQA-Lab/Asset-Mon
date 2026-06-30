import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, Length } from 'class-validator';
import { PlatformAuthGuard } from './platform-auth.guard';
import { SuperAdminOnly } from './super-admin-only.decorator';
import { SuperAdminOnlyGuard } from './super-admin-only.guard';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformMfaService } from './platform-mfa.service';
import { PlatformTenantsService } from './platform-tenants.service';
import { PLANS, type PlanKey } from '../billing/plans';

// Strict allowlist for the operator-update route: only these four fields are
// accepted. forbidNonWhitelisted (below) rejects anything else, so MFA / lock /
// passwordHash columns can never be written through this endpoint.
class UpdateAdminDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsIn(['SUPER_ADMIN', 'SUPPORT']) role?: 'SUPER_ADMIN' | 'SUPPORT';
  @IsOptional() @IsBoolean() active?: boolean;
}
class PeerResetRequestDto {
  @IsString() @Length(1, 200) incidentRef: string;
}
class PeerResetApproveDto {
  @IsString() @Length(6, 6) totpCode: string;
}
class UpdateTenantModulesDto {
  @IsObject() modules: Record<string, boolean>;
}

@ApiTags('platform')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, SuperAdminOnlyGuard)
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly tenants: PlatformTenantsService,
    private readonly auth: PlatformAuthService,
    private readonly mfa: PlatformMfaService,
  ) {}

  // ── Dashboard ────────────────────────────────────────────────────────────
  @Get('metrics')
  metrics() { return this.tenants.metrics(); }

  @Get('plans')
  plans() {
    return Object.values(PLANS).map((p) => ({
      key: p.key,
      name: p.name,
      priceMonthly: p.priceMonthly,
      currency: p.currency,
      perUser: p.perUser,
      limits: p.limits,
      modules: p.modules,
    }));
  }

  // ── Tenants ──────────────────────────────────────────────────────────────
  @Get('tenants')
  list(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('plan') plan?: string,
  ) {
    return this.tenants.list({ search, status, plan });
  }

  @Get('tenants/:id')
  get(@Param('id') id: string) { return this.tenants.getById(id); }

  @Post('tenants/:id/suspend')
  suspend(@Req() req: any, @Param('id') id: string) {
    return this.tenants.setStatus(req.platformUser, id, 'SUSPENDED', req);
  }

  @Post('tenants/:id/activate')
  activate(@Req() req: any, @Param('id') id: string) {
    return this.tenants.setStatus(req.platformUser, id, 'ACTIVE', req);
  }

  @Delete('tenants/:id')
  remove(@Req() req: any, @Param('id') id: string, @Query('confirmSlug') confirmSlug?: string) {
    if (!confirmSlug) throw new BadRequestException('confirmSlug query param is required');
    return this.tenants.hardDelete(req.platformUser, id, confirmSlug, req);
  }

  @Patch('tenants/:id/plan')
  setPlan(@Req() req: any, @Param('id') id: string, @Body() dto: { plan: PlanKey }) {
    return this.tenants.updatePlan(req.platformUser, id, dto.plan, req);
  }

  @Patch('tenants/:id/subscription')
  setSub(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
    return this.tenants.updateSubscription(req.platformUser, id, dto, req);
  }

  // Feature switches for a company (the same toggles as the tenant Settings →
  // Modules page). GET is readable by SUPPORT; PATCH is SUPER_ADMIN-only.
  @Get('tenants/:id/modules')
  getModules(@Param('id') id: string) { return this.tenants.getModules(id); }

  @Patch('tenants/:id/modules')
  @SuperAdminOnly()
  setModules(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTenantModulesDto) {
    return this.tenants.updateModules(req.platformUser, id, dto.modules, req);
  }

  @Get('tenants/:id/users')
  tenantUsers(@Param('id') id: string) { return this.tenants.listTenantUsers(id); }

  @Post('tenants/:id/users/:userId/reset-password')
  resetTenantUserPassword(@Req() req: any, @Param('id') id: string, @Param('userId') userId: string) {
    return this.tenants.resetTenantUserPassword(req.platformUser, id, userId, req);
  }

  // ── Login & access help (Slice 2) ──
  @Post('tenants/:id/users/:userId/reset-mfa')
  @SuperAdminOnly()
  resetTenantUserMfa(@Req() req: any, @Param('id') id: string, @Param('userId') userId: string) {
    return this.tenants.resetTenantUserMfa(req.platformUser, id, userId, req);
  }

  @Post('tenants/:id/users/:userId/unlock')
  @SuperAdminOnly()
  unlockTenantUser(@Req() req: any, @Param('id') id: string, @Param('userId') userId: string) {
    return this.tenants.unlockTenantUser(req.platformUser, id, userId, req);
  }

  @Get('tenants/:id/invite')
  getInvite(@Param('id') id: string) { return this.tenants.getTenantInvite(id); }

  @Post('tenants/:id/invite/regenerate')
  @SuperAdminOnly()
  regenerateInvite(@Req() req: any, @Param('id') id: string) {
    return this.tenants.regenerateTenantInvite(req.platformUser, id, req);
  }

  @Post('tenants/:id/invite/disable')
  @SuperAdminOnly()
  disableInvite(@Req() req: any, @Param('id') id: string) {
    return this.tenants.disableTenantInvite(req.platformUser, id, req);
  }

  @Post('tenants/:id/users/:userId/impersonate')
  impersonate(@Req() req: any, @Param('id') id: string, @Param('userId') userId: string) {
    return this.tenants.impersonate(req.platformUser, id, userId, req);
  }

  // ── Audit ────────────────────────────────────────────────────────────────
  // `limit` is clamped server-side (default 50, ceiling 500) so a query string
  // like `?limit=999999` can't be used to siphon the entire audit log in one
  // request. Negative / NaN values fall back to the default.
  @Get('audit-log')
  audit(
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsed = limit !== undefined ? Number(limit) : NaN;
    const safeLimit = Math.max(1, Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : 50, 500));
    return this.tenants.auditLog({
      actorId, action, targetType, targetId,
      limit: safeLimit,
      cursor: cursor || undefined,
    });
  }

  // ── Team ────────────────────────────────────────────────────────────────
  @Get('admins')
  listAdmins(@Query('limit') limit?: string) {
    const parsed = limit !== undefined ? Number(limit) : NaN;
    return this.auth.listAdmins(Number.isFinite(parsed) ? parsed : undefined);
  }

  @Post('admins')
  createAdmin(@Req() req: any, @Body() dto: any) {
    return this.auth.createAdmin(req.platformUser, dto, req);
  }

  @Patch('admins/:id')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  updateAdmin(@Req() req: any, @Param('id') id: string, @Body() patch: UpdateAdminDto) {
    return this.auth.updateAdmin(req.platformUser, id, patch, req);
  }

  @Post('admins/:id/reset-password')
  resetAdminPassword(@Req() req: any, @Param('id') id: string, @Body() dto: { password: string }) {
    return this.auth.resetAdminPassword(req.platformUser, id, dto.password, req);
  }

  @Delete('admins/:id')
  deleteAdmin(@Req() req: any, @Param('id') id: string) {
    return this.auth.deleteAdmin(req.platformUser, id, req);
  }

  // Governed 4-eyes peer MFA reset — a super-admin opens a request to reset
  // another operator's MFA (needs >=3 super-admins; otherwise use the CLI).
  @Post('admins/:id/reset-mfa')
  requestPeerReset(@Req() req: any, @Param('id') id: string, @Body() dto: PeerResetRequestDto) {
    return this.mfa.requestPeerReset(req.platformUser, id, dto.incidentRef, req);
  }

  // ...and a NEUTRAL second super-admin approves it with a step-up code.
  @Post('admins/reset-mfa/:requestId/approve')
  approvePeerReset(@Req() req: any, @Param('requestId') requestId: string, @Body() dto: PeerResetApproveDto) {
    return this.mfa.approvePeerReset(req.platformUser, requestId, dto.totpCode, req);
  }

  // ── Account self-service ────────────────────────────────────────────────
  @Post('account/password')
  changePassword(@Req() req: any, @Body() dto: { currentPassword: string; newPassword: string }) {
    return this.auth.changePassword(req.platformUser, dto, req);
  }
}
