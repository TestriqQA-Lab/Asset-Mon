import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException,
  Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';
import * as crypto from 'crypto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { ModuleGuard } from '../tenant-settings/module.guard';
import { RequireModule } from '../tenant-settings/require-module.decorator';
import { NavPermissionsGuard } from '../tenant-settings/nav-permissions.guard';
import { RequireNav } from '../tenant-settings/require-nav.decorator';
import { assertSafeOutboundUrl } from '../common/url-safety';

const SCOPES = ['read_only', 'read_write'] as const;
const KEY_ROLES = ['ADMIN', 'ASSET_MANAGER'] as const; // a key acts as full ADMIN or limited ASSET_MANAGER

function genToken(): { token: string; prefix: string; hash: string } {
  const raw = crypto.randomBytes(24).toString('hex'); // 48 chars
  const token = `am_${raw}`;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, prefix: token.slice(0, 8), hash };
}

@Injectable()
class ApiKeysService {
  constructor(private readonly ctx: TenantContextService) {}

  list() {
    return this.ctx.prisma().apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, prefix: true, scope: true, role: true,
        lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true,
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });
  }

  async create(name: string, scope: string, role: string, expiresAt: string | null, creatorId: string) {
    const { token, prefix, hash } = genToken();
    const key = await this.ctx.prisma().apiKey.create({
      data: {
        name, scope, role, prefix, hash,
        createdById: creatorId,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
      select: { id: true, name: true, prefix: true, scope: true, role: true, expiresAt: true, createdAt: true },
    });
    return { ...key, token }; // return token only at creation time
  }

  async revoke(id: string) {
    return this.ctx.prisma().apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  async remove(id: string) {
    return this.ctx.prisma().apiKey.delete({ where: { id } });
  }
}

@Injectable()
class WebhooksService {
  constructor(private readonly ctx: TenantContextService) {}

  list() {
    return this.ctx.prisma().webhook.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { deliveries: true } } },
    });
  }

  async create(url: string, events: string[], active: boolean) {
    await assertSafeOutboundUrl(url);
    const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
    return this.ctx.prisma().webhook.create({ data: { url, events, active, secret } });
  }

  async update(id: string, patch: any) {
    if (patch && typeof patch.url === 'string') {
      await assertSafeOutboundUrl(patch.url);
    }
    return this.ctx.prisma().webhook.update({ where: { id }, data: patch });
  }

  async remove(id: string) {
    return this.ctx.prisma().webhook.delete({ where: { id } });
  }

  deliveries(id: string) {
    return this.ctx.prisma().webhookDelivery.findMany({
      where: { webhookId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}

// ------------ DTOs ------------
class CreateApiKeyDto {
  @IsString() @MinLength(2) name: string;
  @IsOptional() @IsIn(SCOPES as any) scope?: typeof SCOPES[number];
  @IsOptional() @IsIn(KEY_ROLES as any) role?: typeof KEY_ROLES[number];
  @IsOptional() @IsISO8601() expiresAt?: string;
}
class CreateWebhookDto {
  @IsUrl({ require_tld: false }) url: string;
  @IsArray() @IsString({ each: true }) events: string[];
  @IsOptional() @IsBoolean() active?: boolean;
}
class UpdateWebhookDto {
  @IsOptional() @IsUrl({ require_tld: false }) url?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) events?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
}

// ------------ Controllers ------------
@ApiTags('api-keys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ModuleGuard, RolesGuard, NavPermissionsGuard)
@RequireModule('integrations')
@RequireNav('api-keys')
@Controller('api-keys')
class ApiKeysController {
  constructor(private readonly svc: ApiKeysService) {}

  @Get() @Roles('ADMIN') list() { return this.svc.list(); }
  @Post() @Roles('ADMIN')
  create(@Body() d: CreateApiKeyDto, @CurrentUser('sub') uid: string) {
    return this.svc.create(d.name, d.scope || 'read_write', d.role || 'ADMIN', d.expiresAt || null, uid);
  }
  @Post(':id/revoke') @Roles('ADMIN') revoke(@Param('id') id: string) { return this.svc.revoke(id); }
  @Delete(':id') @Roles('ADMIN') remove(@Param('id') id: string) { return this.svc.remove(id); }
}

@ApiTags('webhooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ModuleGuard, RolesGuard, NavPermissionsGuard)
@RequireModule('integrations')
@RequireNav('webhooks')
@Controller('webhooks')
class WebhooksController {
  constructor(private readonly svc: WebhooksService) {}

  @Get() @Roles('ADMIN') list() { return this.svc.list(); }
  @Post() @Roles('ADMIN')
  create(@Body() d: CreateWebhookDto) { return this.svc.create(d.url, d.events, d.active !== false); }
  @Patch(':id') @Roles('ADMIN') update(@Param('id') id: string, @Body() d: UpdateWebhookDto) { return this.svc.update(id, d); }
  @Delete(':id') @Roles('ADMIN') remove(@Param('id') id: string) { return this.svc.remove(id); }
  @Get(':id/deliveries') @Roles('ADMIN') deliveries(@Param('id') id: string) { return this.svc.deliveries(id); }
}

@Module({
  controllers: [ApiKeysController, WebhooksController],
  providers: [ApiKeysService, WebhooksService],
})
export class IntegrationsModule {}
