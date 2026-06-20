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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformTenantsService } from './platform-tenants.service';
import { PLANS, type PlanKey } from '../billing/plans';

@ApiTags('platform')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard)
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly tenants: PlatformTenantsService,
    private readonly auth: PlatformAuthService,
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

  @Get('tenants/:id/users')
  tenantUsers(@Param('id') id: string) { return this.tenants.listTenantUsers(id); }

  @Post('tenants/:id/users/:userId/reset-password')
  resetTenantUserPassword(@Req() req: any, @Param('id') id: string, @Param('userId') userId: string) {
    return this.tenants.resetTenantUserPassword(req.platformUser, id, userId, req);
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
  updateAdmin(@Req() req: any, @Param('id') id: string, @Body() patch: any) {
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

  // ── Account self-service ────────────────────────────────────────────────
  @Post('account/password')
  changePassword(@Req() req: any, @Body() dto: { currentPassword: string; newPassword: string }) {
    return this.auth.changePassword(req.platformUser, dto, req);
  }
}
