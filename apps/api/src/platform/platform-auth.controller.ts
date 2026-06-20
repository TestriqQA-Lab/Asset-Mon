import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAuthGuard } from './platform-auth.guard';

// Platform-admin authentication. Provisioning is intentionally NOT exposed
// over HTTP — there is no /bootstrap endpoint, no /signup, no public way to
// promote a user. The only supported way to add or reset a platform admin is
// the `npm run platform:bootstrap-admin` CLI on the API host (which requires
// catalog DB access). See apps/api/scripts/platform-bootstrap-admin.js.
@ApiTags('platform-auth')
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Post('login')
  @Throttle({ short: { limit: 5, ttl: 1000 }, medium: { limit: 30, ttl: 60_000 } })
  login(@Body() dto: { email: string; password: string }, @Req() req: any) {
    return this.auth.login(dto, req);
  }

  @Post('refresh')
  @Throttle({ short: { limit: 10, ttl: 1000 }, medium: { limit: 30, ttl: 60_000 } })
  refresh(@Body() dto: { refreshToken: string }) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @Throttle({ short: { limit: 10, ttl: 1000 }, medium: { limit: 60, ttl: 60_000 } })
  logout(@Body() dto: { refreshToken?: string }) {
    return this.auth.logout(dto?.refreshToken);
  }

  // logout-all is one bcrypt-cost-12 hash + a token-version bump, so it is much
  // heavier than a regular logout. We rate-limit it aggressively to stop a
  // stolen access token from being used as a denial-of-service primitive
  // against a sleeping admin.
  @Post('logout-all')
  @Throttle({ short: { limit: 2, ttl: 5_000 }, medium: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth()
  @UseGuards(PlatformAuthGuard)
  logoutAll(@Req() req: any) {
    return this.auth.logoutAll(req.platformUser.id);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(PlatformAuthGuard)
  me(@Req() req: any) {
    return req.platformUser;
  }
}
