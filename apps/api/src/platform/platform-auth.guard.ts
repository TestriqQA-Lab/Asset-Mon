import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CatalogPrismaService } from '../catalog/catalog-prisma.service';

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
      payload = this.jwt.verify(token, { secret: process.env.JWT_ACCESS_SECRET });
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    if (!payload?.platform) throw new UnauthorizedException('Not a platform token');

    const user = await this.catalog.platformUser.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, active: true, tokenVersion: true },
    });
    if (!user || !user.active) throw new UnauthorizedException('Session expired');
    if (typeof payload.tv === 'number' && user.tokenVersion !== payload.tv) {
      throw new UnauthorizedException('Session expired');
    }

    req.platformUser = { id: user.id, email: user.email, role: user.role };
    return true;
  }
}
