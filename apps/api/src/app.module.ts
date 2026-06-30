import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard, ThrottlerModuleOptions } from '@nestjs/throttler';
import { HealthController } from './health.controller';
import { CatalogModule } from './catalog/catalog.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { AuthModule } from './auth/auth.module';
import { MeController } from './me/me.controller';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { DepartmentsModule } from './departments/departments.module';
import { LocationsModule } from './locations/locations.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { VendorsModule } from './vendors/vendors.module';
import { AssetsModule } from './assets/assets.module';
import { AuditModule } from './audit/audit.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { TicketsModule } from './tickets/tickets.module';
import { PurchaseRequestsModule } from './procurement/purchase-requests.module';
import { PurchaseOrdersModule } from './procurement/purchase-orders.module';
import { DepreciationModule } from './depreciation/depreciation.module';
import { SoftwareModule } from './software/software.module';
import { ReservationsModule } from './reservations/reservations.module';
import { PhysicalAuditsModule } from './physical-audits/physical-audits.module';
import { EventsModule } from './events/events.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { ReportsModule } from './reports/reports.module';
import { TenantSettingsModule } from './tenant-settings/tenant-settings.module';
import { ModuleGuard } from './tenant-settings/module.guard';
import { NotificationsModule } from './notifications/notifications.module';
import { SearchModule } from './search/search.module';
import { TwoFAModule } from './auth/twofa.module';
import { TenantMfaModule } from './auth/tenant-mfa.module';
import { BillingModule } from './billing/billing.module';
import { AssetStatusDefsModule } from './asset-status-defs/asset-status-defs.module';
import { SavedViewsModule } from './saved-views/saved-views.module';
import { AssetAttachmentsModule } from './asset-attachments/asset-attachments.module';
import { WorkspaceInviteModule } from './workspace-invite/workspace-invite.module';
import { PlatformModule } from './platform/platform.module';
import { SupportModule } from './support/support.module';

function normaliseIpKey(raw: any): string {
  const first = typeof raw === 'string' ? raw.split(',')[0].trim() : '';
  if (!first) return 'ip:unknown';
  // IPv4 → keep full
  if (/^\d+\.\d+\.\d+\.\d+$/.test(first)) return `v4:${first}`;
  // IPv6 → keep first 4 hextets (/64); drop everything after to defeat rotation
  if (first.includes(':')) {
    const parts = first.replace(/^\[|\]$/g, '').split(':');
    const head = parts.slice(0, 4).join(':');
    return `v6:${head}`;
  }
  return `ip:${first}`;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'short', ttl: 1000, limit: 20 },
        { name: 'medium', ttl: 60_000, limit: 300 },
      ],
      // Custom tracker: keys IPv6 by /64 so :1-style address rotation cannot bypass.
      getTracker: (req: any) => normaliseIpKey(req.ip || req.headers?.['x-forwarded-for']),
    } as ThrottlerModuleOptions),
    CatalogModule,
    TenancyModule,
    WorkspaceInviteModule,
    AuthModule,
    DepartmentsModule,
    LocationsModule,
    UsersModule,
    CategoriesModule,
    VendorsModule,
    AssetsModule,
    AuditModule,
    DashboardModule,
    MaintenanceModule,
    TicketsModule,
    PurchaseRequestsModule,
    PurchaseOrdersModule,
    DepreciationModule,
    SoftwareModule,
    ReservationsModule,
    PhysicalAuditsModule,
    EventsModule,
    IntegrationsModule,
    ReportsModule,
    TenantSettingsModule,
    BillingModule,
    NotificationsModule,
    SearchModule,
    TwoFAModule,
    TenantMfaModule,
    AssetStatusDefsModule,
    SavedViewsModule,
    AssetAttachmentsModule,
    PlatformModule,
    SupportModule,
  ],
  controllers: [HealthController, MeController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    JwtAuthGuard,
    RolesGuard,
    ModuleGuard,
  ],
  exports: [ModuleGuard],
})
export class AppModule {}
