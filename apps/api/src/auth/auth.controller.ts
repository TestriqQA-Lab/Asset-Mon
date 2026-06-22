import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignupDto, LoginDto, RefreshDto, AcceptInviteDto, LogoutDto, MfaStepDto } from './dto';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from './jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  @Throttle({ short: { limit: 3, ttl: 1000 }, medium: { limit: 10, ttl: 60_000 } })
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  // Per-IP login limit. Per-account credential-stuffing protection is enforced
  // separately by the lockout machinery in AuthService.login.
  @Post('login')
  @Throttle({ short: { limit: 5, ttl: 1000 }, medium: { limit: 30, ttl: 60_000 } })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  // Step 2 of the tenant login chain (when the user has email MFA enabled).
  @Post('mfa/email')
  @Throttle({ short: { limit: 6, ttl: 60_000 }, medium: { limit: 20, ttl: 600_000 } })
  mfaEmail(@Body() dto: MfaStepDto) {
    return this.auth.loginMfaEmail(dto.ticket, dto.code);
  }

  // Step 3 of the tenant login chain (EMAIL_TOTP users only).
  @Post('mfa/totp')
  @Throttle({ short: { limit: 6, ttl: 60_000 }, medium: { limit: 20, ttl: 600_000 } })
  mfaTotp(@Body() dto: MfaStepDto) {
    return this.auth.loginMfaTotp(dto.ticket, dto.code);
  }

  @Post('refresh')
  @Throttle({ short: { limit: 10, ttl: 1000 }, medium: { limit: 30, ttl: 60_000 } })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @Throttle({ short: { limit: 10, ttl: 1000 }, medium: { limit: 60, ttl: 60_000 } })
  logout(@Body() dto: LogoutDto) {
    return this.auth.logout(dto?.refreshToken);
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @Throttle({ short: { limit: 2, ttl: 1000 }, medium: { limit: 10, ttl: 60_000 } })
  logoutAll(@Req() req: any) {
    return this.auth.logoutAll(req.user.tid, req.user.sub);
  }

  @Get('invite/:token')
  @Throttle({ short: { limit: 10, ttl: 1000 }, medium: { limit: 60, ttl: 60_000 } })
  inspectInvite(@Param('token') token: string) {
    return this.auth.inspectInvite(token);
  }

  @Post('invite/:token')
  @Throttle({ short: { limit: 3, ttl: 1000 }, medium: { limit: 10, ttl: 60_000 } })
  acceptInvite(@Param('token') token: string, @Body() dto: AcceptInviteDto) {
    return this.auth.acceptInvite(token, dto);
  }
}
