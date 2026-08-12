import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { TenantMfaService } from './tenant-mfa.service';
import { AuthService } from './auth.service';

class RecoveryDto {
  @IsEmail() email: string;
  @IsOptional() @IsBoolean() acknowledgeRisk?: boolean;
}
class CodeDto {
  @IsString() @Length(4, 16) code: string;
}
class EnableDto {
  @IsIn(['EMAIL', 'EMAIL_TOTP']) method: 'EMAIL' | 'EMAIL_TOTP';
  @IsOptional() @IsString() password?: string; // required only for a level switch
}
class DisableDto {
  @IsString() password: string;
}

/**
 * Tenant-user self-service MFA settings (the dashboard "security" backend).
 * Authenticated (JwtAuthGuard); operates on the caller's own account in the
 * current tenant DB.
 */
@ApiTags('me-mfa')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/mfa')
export class TenantMfaController {
  constructor(
    private readonly svc: TenantMfaService,
    private readonly ctx: TenantContextService,
    private readonly auth: AuthService,
  ) {}

  // Re-issue the CALLER's own session after an MFA change bumped tokenVersion,
  // so the acting device stays signed in while every other session is dropped.
  // Mirrors the claims already on the request's access token (req.user).
  private reissue(u: any, tokenVersion: number) {
    return this.auth.issueTokens(u.tid, u.slug, u.sub, u.role, u.email, tokenVersion);
  }

  @Get()
  status(@CurrentUser('sub') uid: string) {
    return this.svc.status(this.ctx.prisma(), uid);
  }

  @Post('recovery/send')
  @Throttle({ short: { limit: 3, ttl: 60_000 }, medium: { limit: 10, ttl: 600_000 } })
  sendRecovery(@CurrentUser('sub') uid: string, @Body() dto: RecoveryDto) {
    return this.svc.sendRecovery(this.ctx.prisma(), uid, dto.email, !!dto.acknowledgeRisk);
  }

  @Post('recovery/verify')
  @Throttle({ short: { limit: 6, ttl: 60_000 }, medium: { limit: 20, ttl: 600_000 } })
  verifyRecovery(@CurrentUser('sub') uid: string, @Body() dto: CodeDto) {
    return this.svc.verifyRecovery(this.ctx.prisma(), uid, dto.code);
  }

  @Post('enable')
  @Throttle({ short: { limit: 5, ttl: 60_000 }, medium: { limit: 15, ttl: 600_000 } })
  async enable(@CurrentUser() u: any, @Body() dto: EnableDto) {
    const { tokenVersion, ...rest } = await this.svc.enable(this.ctx.prisma(), u.sub, dto.method, dto.password);
    return { ...rest, tokens: this.reissue(u, tokenVersion) };
  }

  @Post('disable')
  @Throttle({ short: { limit: 5, ttl: 60_000 }, medium: { limit: 15, ttl: 600_000 } })
  async disable(@CurrentUser() u: any, @Body() dto: DisableDto) {
    const { tokenVersion, ...rest } = await this.svc.disable(this.ctx.prisma(), u.sub, dto.password) as any;
    // tokenVersion is absent on the no-op path (MFA was already off) — nothing to re-issue.
    return tokenVersion == null ? rest : { ...rest, tokens: this.reissue(u, tokenVersion) };
  }
}
