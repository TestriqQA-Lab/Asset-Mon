import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CatalogPrismaService } from '../catalog/catalog-prisma.service';
import { mfaSetupComplete } from './platform-mfa.util';

/**
 * Guards every `/api/platform/*` route. Accepts a JWT issued by
 * PlatformAuthService (carries `platform: true`) and re-checks the user's
 * tokenVersion + active flag on every request.
 *
 * NOTE: per the user's "bypass permissions" instruction we do not gate on
 * SUPER_ADMIN vs SUPPORT here — any authenticated platform user can hit any
 * platform endpoint. The decoded payload is still attached as req.platformUser
 * so role-based checks can be wired in later without an API change.
 */
@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly catalog: CatalogPrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers['authorization'] as string | undefined;
    if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('Missing token');
    const token = auth.slice('Bearer '.length);

    let payload: any;
    try {
      payload = this.jwt.verify(token, { secret: process.env.JWT_ACCESS_SECRET, algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    // Must be a platform ACCESS token — never an MFA ticket (different `purpose`,
    // no `platform` flag), so a ticket cannot be replayed as an access token.
    if (!payload?.platform || payload.purpose !== 'access') throw new UnauthorizedException('Not a platform token');

    const user = await this.catalog.platformUser.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, email: true, role: true, active: true, tokenVersion: true,
        primaryEmailVerifiedAt: true, totpEnabled: true, totpSecret: true,
        recoveryEmail: true, recoveryEmailVerifiedAt: true, backupCodesGeneratedAt: true, mfaEnrolledAt: true,
      },
    });
    if (!user || !user.active) throw new UnauthorizedException('Session expired');
    if (typeof payload.tv === 'number' && user.tokenVersion !== payload.tv) {
      throw new UnauthorizedException('Session expired');
    }
    // Hard MFA gate: an operator who is not fully enrolled cannot reach ANY
    // platform route (setup uses the separate setup-ticket guard).
    if ((user.role === 'SUPER_ADMIN' || user.role === 'SUPPORT') && !mfaSetupComplete(user)) {
      throw new UnauthorizedException({ code: 'MFA_SETUP_REQUIRED' });
    }

    req.platformUser = { id: user.id, email: user.email, role: user.role };
    return true;
  }
}
