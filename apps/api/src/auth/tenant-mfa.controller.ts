import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { TenantMfaService } from './tenant-mfa.service';

class RecoveryDto {
  @IsEmail() email: string;
  @IsOptional() @IsBoolean() acknowledgeRisk?: boolean;
}
class CodeDto {
  @IsString() @Length(4, 16) code: string;
}
class EnableDto {
  @IsIn(['EMAIL', 'EMAIL_TOTP']) method: 'EMAIL' | 'EMAIL_TOTP';
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
  ) {}

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
  enable(@CurrentUser('sub') uid: string, @Body() dto: EnableDto) {
    return this.svc.enable(this.ctx.prisma(), uid, dto.method);
  }

  @Post('disable')
  @Throttle({ short: { limit: 5, ttl: 60_000 }, medium: { limit: 15, ttl: 600_000 } })
  disable(@CurrentUser('sub') uid: string, @Body() dto: DisableDto) {
    return this.svc.disable(this.ctx.prisma(), uid, dto.password);
  }
}
