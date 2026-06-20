import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { CatalogPrismaService } from '../catalog/catalog-prisma.service';

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(
    private readonly ctx: TenantContextService,
    private readonly catalog: CatalogPrismaService,
  ) {}

  @Get()
  async me() {
    const db = this.ctx.prisma();
    const [user, tenant] = await Promise.all([
      db.user.findUnique({ where: { id: this.ctx.userId! } }),
      this.catalog.tenant.findUnique({
        where: { id: this.ctx.tenantId! },
        // The dbName / settings.razorpay* values are server-side concerns; do not
        // expose them via /me.
        select: { id: true, slug: true, name: true },
      }),
    ]);
    return {
      user: user
        ? { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }
        : null,
      tenant,
    };
  }
}
