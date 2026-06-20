import { Injectable, Scope, Inject } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';
import { PrismaClient } from '@assetmon/db-tenant';
import { TenantPrismaPool } from './tenant-prisma.pool';

@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  constructor(
    @Inject(REQUEST) private readonly req: Request & { tenant?: any; user?: any },
    private readonly pool: TenantPrismaPool,
  ) {}

  get tenantId(): string | undefined {
    return this.req.tenant?.id;
  }

  get tenantDbName(): string | undefined {
    return this.req.tenant?.dbName;
  }

  get userId(): string | undefined {
    return this.req.user?.sub;
  }

  get role(): string | undefined {
    return this.req.user?.role;
  }

  /**
   * If the current request is being made through a platform-admin impersonation
   * token, returns the platform-admin's user id. `undefined` otherwise.
   * Threaded into every audit entry so platform "view-as" actions are
   * unmistakable downstream.
   */
  get impersonatedBy(): string | undefined {
    const v = this.req.user?.impersonatedBy;
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  }

  prisma(): PrismaClient {
    if (!this.tenantDbName) throw new Error('No tenant context');
    return this.pool.get(this.tenantDbName);
  }
}
