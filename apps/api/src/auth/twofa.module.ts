import { BadRequestException, Body, Controller, Get, Injectable, Module, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, Length } from 'class-validator';
import { authenticator } from 'otplib';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { CurrentUser } from './current-user.decorator';
import { SITE_NAME } from './twofa.constants';
import { encryptSecret, decryptSecret } from '../common/crypto';

// Pending TOTP secrets are kept in memory until the user verifies the first code.
// Until then the previously-enabled secret stays valid, so a half-finished
// re-enroll cannot strand the user without 2FA.
const PENDING_TTL_MS = 10 * 60_000;
const pendingSecrets = new Map<string, { secret: string; expiresAt: number }>();
function getPending(userId: string): string | null {
  const e = pendingSecrets.get(userId);
  if (!e) return null;
  if (e.expiresAt < Date.now()) { pendingSecrets.delete(userId); return null; }
  return e.secret;
}

@Injectable()
class TwoFAService {
  constructor(private readonly ctx: TenantContextService) {}

  async startEnroll(userId: string, email: string, tenantSlug: string) {
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(email, `${SITE_NAME} (${tenantSlug})`, secret);
    pendingSecrets.set(userId, { secret, expiresAt: Date.now() + PENDING_TTL_MS });
    return { secret, otpauth };
  }

  async verifyAndEnable(userId: string, token: string) {
    const pending = getPending(userId);
    if (!pending) throw new BadRequestException('Start enrollment first');
    if (!authenticator.check(token, pending)) throw new UnauthorizedException('Invalid TOTP code');
    // Only at this point do we overwrite any previously enabled secret.
    await this.ctx.prisma().user.update({
      where: { id: userId },
      data: { totpSecret: encryptSecret(pending), totpEnabled: true, tokenVersion: { increment: 1 } },
    });
    pendingSecrets.delete(userId);
    return { ok: true };
  }

  async disable(userId: string, token: string) {
    const u = await this.ctx.prisma().user.findUnique({ where: { id: userId } });
    if (!u?.totpEnabled || !u.totpSecret) return { ok: true };
    let secret: string;
    try { secret = decryptSecret(u.totpSecret); }
    catch { throw new BadRequestException('Re-enroll required'); }
    if (!authenticator.check(token, secret)) throw new UnauthorizedException('Invalid TOTP code');
    await this.ctx.prisma().user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabled: false, tokenVersion: { increment: 1 } },
    });
    pendingSecrets.delete(userId);
    return { ok: true };
  }

  async status(userId: string) {
    const u = await this.ctx.prisma().user.findUnique({ where: { id: userId }, select: { totpEnabled: true } });
    return { enabled: !!u?.totpEnabled };
  }
}

class VerifyDto { @IsString() @Length(6, 6) token: string; }

@ApiTags('2fa')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/2fa')
class TwoFAController {
  constructor(private readonly svc: TwoFAService) {}

  @Get()
  status(@CurrentUser('sub') uid: string) { return this.svc.status(uid); }

  @Post('enroll')
  @Throttle({ short: { limit: 3, ttl: 60_000 }, medium: { limit: 10, ttl: 600_000 } })
  enroll(@CurrentUser('sub') uid: string, @CurrentUser('email') email: string, @CurrentUser('slug') slug: string) {
    return this.svc.startEnroll(uid, email, slug);
  }

  @Post('verify')
  @Throttle({ short: { limit: 5, ttl: 60_000 }, medium: { limit: 20, ttl: 600_000 } })
  verify(@CurrentUser('sub') uid: string, @Body() dto: VerifyDto) {
    return this.svc.verifyAndEnable(uid, dto.token);
  }

  @Post('disable')
  @Throttle({ short: { limit: 5, ttl: 60_000 }, medium: { limit: 20, ttl: 600_000 } })
  disable(@CurrentUser('sub') uid: string, @Body() dto: VerifyDto) {
    return this.svc.disable(uid, dto.token);
  }
}

@Module({ controllers: [TwoFAController], providers: [TwoFAService] })
export class TwoFAModule {}
