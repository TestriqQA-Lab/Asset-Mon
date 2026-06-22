import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsEmail, IsOptional, IsString, Length } from 'class-validator';
import { PlatformMfaService } from './platform-mfa.service';
import { PlatformSetupTicketGuard } from './platform-setup-ticket.guard';

class CodeDto {
  @IsString() @Length(4, 16) code: string;
}
class TotpDto {
  @IsString() @Length(6, 6) token: string;
}
class RecoveryEmailDto {
  @IsEmail() email: string;
  @IsOptional() @IsBoolean() acknowledgeRisk?: boolean;
}

/**
 * MFA enrolment wizard for platform operators. Every route is behind the
 * mfa_setup ticket (PlatformSetupTicketGuard) — NOT a normal access token. The
 * operator reaches here after `login` returns MFA_SETUP_REQUIRED + a setupTicket.
 */
@ApiTags('platform-mfa-setup')
@Controller('platform/mfa/setup')
@UseGuards(PlatformSetupTicketGuard)
export class PlatformMfaSetupController {
  constructor(private readonly mfa: PlatformMfaService) {}

  @Get('state')
  state(@Req() req: any) {
    return this.mfa.getState(req.setupUser);
  }

  @Post('primary-email/send')
  @Throttle({ short: { limit: 3, ttl: 60_000 }, medium: { limit: 10, ttl: 600_000 } })
  sendPrimary(@Req() req: any) {
    return this.mfa.sendPrimaryEmail(req.setupUser);
  }

  @Post('primary-email/verify')
  @Throttle({ short: { limit: 6, ttl: 60_000 }, medium: { limit: 20, ttl: 600_000 } })
  verifyPrimary(@Req() req: any, @Body() dto: CodeDto) {
    return this.mfa.verifyPrimaryEmail(req.setupUser, dto.code, req);
  }

  @Post('totp/start')
  @Throttle({ short: { limit: 5, ttl: 60_000 }, medium: { limit: 15, ttl: 600_000 } })
  startTotp(@Req() req: any) {
    return this.mfa.startTotp(req.setupUser);
  }

  @Post('totp/verify')
  @Throttle({ short: { limit: 6, ttl: 60_000 }, medium: { limit: 20, ttl: 600_000 } })
  verifyTotp(@Req() req: any, @Body() dto: TotpDto) {
    return this.mfa.verifyTotp(req.setupUser, dto.token, req);
  }

  @Post('recovery-email/send')
  @Throttle({ short: { limit: 3, ttl: 60_000 }, medium: { limit: 10, ttl: 600_000 } })
  sendRecovery(@Req() req: any, @Body() dto: RecoveryEmailDto) {
    return this.mfa.sendRecoveryEmail(req.setupUser, dto.email, !!dto.acknowledgeRisk, req);
  }

  @Post('recovery-email/verify')
  @Throttle({ short: { limit: 6, ttl: 60_000 }, medium: { limit: 20, ttl: 600_000 } })
  verifyRecovery(@Req() req: any, @Body() dto: CodeDto) {
    return this.mfa.verifyRecoveryEmail(req.setupUser, dto.code, req);
  }

  @Post('backup-codes/generate')
  @Throttle({ short: { limit: 3, ttl: 60_000 }, medium: { limit: 10, ttl: 600_000 } })
  backupCodes(@Req() req: any) {
    return this.mfa.generateBackupCodes(req.setupUser, req);
  }

  @Post('complete')
  @Throttle({ short: { limit: 5, ttl: 60_000 }, medium: { limit: 15, ttl: 600_000 } })
  complete(@Req() req: any) {
    return this.mfa.complete(req.setupUser, req);
  }
}
