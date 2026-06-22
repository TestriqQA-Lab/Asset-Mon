import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { CatalogPrismaService } from '../catalog/catalog-prisma.service';
import { MfaTicketService, MFA_TICKET_PURPOSE } from '../common/mfa/mfa-ticket.service';

/**
 * Guards the MFA setup wizard routes. Accepts ONLY a valid `mfa_setup` ticket
 * (never an access token), re-loads the operator, and re-checks active/lock/role
 * + tokenVersion on every request, so completing setup (which bumps
 * tokenVersion) or a password reset immediately invalidates the ticket. The full
 * user row is attached as req.setupUser for the controller/service.
 */
@Injectable()
export class PlatformSetupTicketGuard implements CanActivate {
  constructor(
    private readonly mfaTicket: MfaTicketService,
    private readonly catalog: CatalogPrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers['authorization'] as string | undefined;
    if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('Missing setup ticket');
    const token = auth.slice('Bearer '.length);

    // Throws { code: MFA_RESTART } on bad signature / wrong purpose / expiry.
    const claims = this.mfaTicket.verify(token, MFA_TICKET_PURPOSE.SETUP);
    if (claims.scope !== 'platform' || !claims.sub) {
      throw new UnauthorizedException({ code: 'MFA_RESTART', message: 'Invalid setup ticket' });
    }

    const user = await this.catalog.platformUser.findUnique({ where: { id: claims.sub } });
    if (!user || !user.active) throw new UnauthorizedException('Session expired');
    if (user.lockedUntil && user.lockedUntil > new Date()) throw new UnauthorizedException('Account temporarily locked.');
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'SUPPORT') throw new UnauthorizedException('Not an operator');
    if (typeof (claims as any).tv === 'number' && user.tokenVersion !== (claims as any).tv) {
      throw new UnauthorizedException({ code: 'MFA_RESTART', message: 'Setup ticket no longer valid' });
    }

    req.setupUser = user;
    return true;
  }
}
