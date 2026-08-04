import { Injectable, Scope, Inject } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';
import { GlobalPrismaService } from './global-prisma.service';
import type { ScopedPrismaClient } from './scoped-client';

@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  private client: ScopedPrismaClient | null = null;

  constructor(
    @Inject(REQUEST) private readonly req: Request & { tenant?: any; user?: any },
    private readonly globalPrisma: GlobalPrismaService,
  ) {}

  get tenantId(): string | undefined {
    return this.req.tenant?.id;
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

  /**
   * The tenant-scoped client for this request. Memoised per request because
   * `$extends` builds a new client each call.
   */
  prisma(): ScopedPrismaClient {
    const tid = this.tenantId;
    if (!tid) throw new Error('No tenant context');
    if (!this.client) this.client = this.globalPrisma.forTenant(tid);
    return this.client;
  }
}
