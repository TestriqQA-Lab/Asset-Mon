import { BadRequestException, Controller, Get, Injectable, Module, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TenantContextService } from '../tenancy/tenant-context.service';

@Injectable()
class SearchService {
  constructor(private readonly ctx: TenantContextService) {}

  async search(q: string) {
    if (!q || q.length < 2) return { assets: [], tickets: [], users: [] };
    if (q.length > 80) throw new BadRequestException('Query too long');
    const db = this.ctx.prisma();
    const ins = { contains: q };
    const [assets, tickets, users] = await Promise.all([
      db.asset.findMany({
        where: { OR: [{ name: ins }, { assetTag: ins }, { serialNumber: ins }] },
        select: { id: true, assetTag: true, name: true, status: true },
        take: 8,
      }),
      db.serviceTicket.findMany({
        where: { OR: [{ title: ins }, { ticketNumber: ins }] },
        select: { id: true, ticketNumber: true, title: true, status: true },
        take: 5,
      }),
      db.user.findMany({
        where: { OR: [{ firstName: ins }, { lastName: ins }, { email: ins }] },
        select: { id: true, firstName: true, lastName: true, email: true, role: true },
        take: 5,
      }),
    ]);
    return { assets, tickets, users };
  }
}

@ApiTags('search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('search')
class SearchController {
  constructor(private readonly svc: SearchService) {}
  // Search returns user / asset / ticket records — including emails and ticket
  // titles that may be sensitive. Limit to roles that already have visibility
  // over those records elsewhere in the app. EMPLOYEE has no need for it.
  @Get()
  @Roles('ADMIN', 'ASSET_MANAGER')
  @Throttle({ short: { limit: 10, ttl: 1000 }, medium: { limit: 120, ttl: 60_000 } })
  search(@Query('q') q: string) { return this.svc.search(q || ''); }
}

@Module({ controllers: [SearchController], providers: [SearchService] })
export class SearchModule {}
