import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Global, Headers, HttpCode,
  Injectable, Module, Post, Req, UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CatalogPrismaService } from '../catalog/catalog-prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { PLANS, type PlanKey } from './plans';
import { RazorpayService } from './razorpay.service';

@Injectable()
export class BillingService {
  constructor(
    private readonly catalog: CatalogPrismaService,
    private readonly ctx: TenantContextService,
    private readonly razorpay: RazorpayService,
  ) {}

  async usage(tenantId: string) {
    const db = this.ctx.prisma();
    const [users, assets] = await Promise.all([db.user.count(), db.asset.count()]);
    return { users, assets };
  }

  async summary(tenantId: string) {
    const t = await this.catalog.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new BadRequestException('Tenant not found');
    const planKey: PlanKey = (PLANS[t.plan as PlanKey] ? t.plan : 'business') as PlanKey;
    const plan = PLANS[planKey];
    const usage = await this.usage(tenantId);
    const now = new Date();
    const inTrial = t.subscriptionStatus === 'trialing' && !!t.trialEndsAt && t.trialEndsAt > now;
    return {
      plan,
      planKey,
      status: t.subscriptionStatus,
      trialEndsAt: t.trialEndsAt,
      inTrial,
      daysRemainingInTrial: inTrial && t.trialEndsAt ? Math.max(0, Math.ceil((+t.trialEndsAt - +now) / 86_400_000)) : 0,
      currentPeriodEnd: t.currentPeriodEnd,
      razorpaySubscriptionId: t.razorpaySubscriptionId,
      provider: 'razorpay',
      providerEnabled: this.razorpay.isEnabled(),
      usage,
      limits: plan.limits,
    };
  }

  /**
   * Switch the tenant to a different plan.
   * - Starter / Enterprise: no Razorpay checkout (free / sales-led) → flips immediately.
   * - Business: when Razorpay is configured, returns a hosted `short_url` for the user to complete checkout.
   *   When Razorpay is disabled (dev mode), flips immediately.
   */
  async changePlan(tenantId: string, planKey: PlanKey, adminEmail: string) {
    if (!PLANS[planKey]) throw new BadRequestException('Unknown plan');

    if (planKey === 'starter' || planKey === 'enterprise') {
      // Free or sales-led plan; cancel any existing paid sub then flip.
      const t = await this.catalog.tenant.findUnique({ where: { id: tenantId } });
      if (t?.razorpaySubscriptionId && this.razorpay.isEnabled()) {
        try { await this.razorpay.cancelSubscription(t.razorpaySubscriptionId, true); } catch {}
      }
      await this.catalog.tenant.update({
        where: { id: tenantId },
        data: {
          plan: planKey,
          subscriptionStatus: 'active',
          currentPeriodEnd: planKey === 'starter' ? null : new Date(Date.now() + 30 * 86_400_000),
          razorpaySubscriptionId: null,
        },
      });
      return { ok: true, planKey, checkoutUrl: null, ...(await this.summary(tenantId)) };
    }

    // Business → real Razorpay subscription if configured, otherwise dev-mode flip.
    if (!this.razorpay.isEnabled()) {
      await this.catalog.tenant.update({
        where: { id: tenantId },
        data: { plan: planKey, subscriptionStatus: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) },
      });
      return { ok: true, planKey, checkoutUrl: null, devMode: true, ...(await this.summary(tenantId)) };
    }

    const planId = this.razorpay.planIdFor(planKey);
    if (!planId) throw new BadRequestException(`No Razorpay plan ID configured for "${planKey}"`);

    const t = await this.catalog.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new BadRequestException('Tenant not found');

    let customerId = t.razorpayCustomerId || undefined;
    if (!customerId) {
      const customer = await this.razorpay.createCustomer({ email: adminEmail, name: t.name });
      customerId = (customer as any).id;
      await this.catalog.tenant.update({ where: { id: tenantId }, data: { razorpayCustomerId: customerId } });
    }

    const sub = await this.razorpay.createSubscription({
      planId,
      customerId,
      notes: { tenantId: t.id, slug: t.slug },
    });

    await this.catalog.tenant.update({
      where: { id: tenantId },
      data: {
        plan: planKey,
        subscriptionStatus: 'pending',
        razorpaySubscriptionId: (sub as any).id,
        razorpayPlanId: planId,
      },
    });

    return {
      ok: true,
      planKey,
      subscriptionId: (sub as any).id,
      checkoutUrl: (sub as any).short_url || null,
      ...(await this.summary(tenantId)),
    };
  }

  async handleRazorpayEvent(event: any) {
    const type: string = event?.event || '';
    const sub = event?.payload?.subscription?.entity;
    if (!sub) return { ok: true, ignored: true };

    const tenant = await this.catalog.tenant.findFirst({ where: { razorpaySubscriptionId: sub.id } });
    if (!tenant) return { ok: true, ignored: true };

    const status = mapRazorpayStatus(type, sub);
    const data: any = { subscriptionStatus: status };
    if (sub.current_end) data.currentPeriodEnd = new Date(sub.current_end * 1000);
    await this.catalog.tenant.update({ where: { id: tenant.id }, data });
    return { ok: true, status };
  }

  async assertCanAddUser(tenantId: string) {
    const s = await this.summary(tenantId);
    if (s.limits.users != null && s.usage.users >= s.limits.users) {
      throw new ForbiddenException(`Plan limit reached (${s.limits.users} users). Upgrade to add more.`);
    }
  }

  async assertCanAddAsset(tenantId: string) {
    const s = await this.summary(tenantId);
    if (s.limits.assets != null && s.usage.assets >= s.limits.assets) {
      throw new ForbiddenException(`Plan limit reached (${s.limits.assets} assets). Upgrade to add more.`);
    }
  }
}

function mapRazorpayStatus(eventType: string, sub: any): string {
  // Razorpay status: created, authenticated, active, pending, halted, cancelled, completed, expired
  if (sub.status === 'active') return 'active';
  if (sub.status === 'cancelled') return 'cancelled';
  if (sub.status === 'completed' || sub.status === 'expired') return 'expired';
  if (sub.status === 'pending' || sub.status === 'halted') return 'past_due';
  if (eventType === 'subscription.activated') return 'active';
  return sub.status || 'pending';
}

class ChangePlanDto { @IsIn(['starter', 'business', 'enterprise']) plan: PlanKey; }

@ApiTags('billing')
// Note: `GET /billing` is read by every page (trial banner) so we don't gate
// the controller behind `@RequireNav('settings:billing')`. The Settings menu
// link visibility uses the nav key client-side; `change-plan` is ADMIN-only.
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('billing')
class BillingController {
  constructor(private readonly svc: BillingService) {}

  @Get() summary(@CurrentUser('tid') tid: string) { return this.svc.summary(tid); }

  @Post('change-plan') @Roles('ADMIN')
  changePlan(@CurrentUser('tid') tid: string, @CurrentUser('email') email: string, @Body() dto: ChangePlanDto) {
    return this.svc.changePlan(tid, dto.plan, email);
  }
}

@ApiTags('billing')
@Controller('billing/razorpay')
class RazorpayWebhookController {
  constructor(private readonly billing: BillingService, private readonly razorpay: RazorpayService) {}

  @Post('webhook')
  @HttpCode(200)
  @Throttle({ short: { limit: 30, ttl: 1000 }, medium: { limit: 600, ttl: 60_000 } })
  async webhook(@Req() req: any, @Headers('x-razorpay-signature') sig?: string) {
    const raw = (req.rawBody as Buffer | undefined)?.toString('utf8') ?? JSON.stringify(req.body ?? {});
    if (!this.razorpay.verifyWebhook(raw, sig)) {
      // Return 200 with ignored=true: Razorpay retries on non-200; we don't want a forever-loop on a misconfig.
      return { ok: false, reason: 'invalid signature' };
    }
    return this.billing.handleRazorpayEvent(req.body);
  }
}

@Global()
@Module({
  controllers: [BillingController, RazorpayWebhookController],
  providers: [BillingService, RazorpayService],
  exports: [BillingService, RazorpayService],
})
export class BillingModule {}
