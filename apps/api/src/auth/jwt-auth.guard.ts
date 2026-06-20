import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { CatalogPrismaService } from '../catalog/catalog-prisma.service';
import { TenantPrismaPool } from '../tenancy/tenant-prisma.pool';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly catalog: CatalogPrismaService,
    private readonly pool: TenantPrismaPool,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers['authorization'] as string | undefined;
    const apiKey = (req.headers['x-api-key'] as string | undefined) || '';
    const slugHeader = (req.headers['x-tenant-slug'] as string | undefined) || '';

    if (auth && auth.startsWith('Bearer ')) {
      return this.authenticateJwt(req, auth.slice('Bearer '.length));
    }
    if (apiKey) {
      return this.authenticateApiKey(req, apiKey, slugHeader);
    }
    throw new UnauthorizedException('Missing token');
  }

  private async authenticateJwt(req: any, token: string): Promise<boolean> {
    let payload: any;
    try {
      payload = this.jwt.verify(token, { secret: process.env.JWT_ACCESS_SECRET });
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    const tenant = await this.catalog.tenant.findUnique({ where: { id: payload.tid } });
    if (!tenant || tenant.status !== 'ACTIVE') throw new UnauthorizedException('Workspace not active');

    // Verify the token-version embedded in the JWT still matches the user's
    // server-side counter. Bumping `User.tokenVersion` (logout-all, role change,
    // password reset) immediately invalidates every access token in circulation.
    if (typeof payload.tv === 'number') {
      const db = this.pool.get(tenant.dbName);
      const u = await db.user.findUnique({ where: { id: payload.sub }, select: { tokenVersion: true, active: true } }).catch(() => null);
      if (!u || !u.active) throw new UnauthorizedException('Session expired');
      if (u.tokenVersion !== payload.tv) throw new UnauthorizedException('Session expired');
    }

    req.user = payload;
    req.tenant = tenant;
    return true;
  }

  private async authenticateApiKey(req: any, apiKey: string, slug: string): Promise<boolean> {
    if (!slug) throw new UnauthorizedException('X-Tenant-Slug header required for API key auth');
    const tenant = await this.catalog.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status !== 'ACTIVE') throw new UnauthorizedException('Workspace not active');
    const db = this.pool.get(tenant.dbName);
    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const key = await db.apiKey.findUnique({ where: { hash } });
    if (!key) throw new UnauthorizedException('Invalid API key');
    if (key.revokedAt) throw new UnauthorizedException('API key revoked');
    if (key.expiresAt && key.expiresAt < new Date()) throw new UnauthorizedException('API key expired');

    // Block write methods for read_only scope
    if (key.scope === 'read_only' && !['GET', 'HEAD'].includes(req.method)) {
      throw new ForbiddenException('API key is read-only');
    }

    db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

    req.user = {
      sub: key.createdById || 'apikey:' + key.id,
      tid: tenant.id,
      slug: tenant.slug,
      db: tenant.dbName,
      role: 'ADMIN', // API keys act with full role; refine to scope-based later if needed
      email: 'apikey@' + tenant.slug,
      apiKeyId: key.id,
    };
    req.tenant = tenant;
    return true;
  }
}
