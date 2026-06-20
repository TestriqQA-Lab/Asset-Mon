import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@assetmon/db-tenant';
import { TenantProvisioningService } from './tenant-provisioning.service';

type CacheEntry = { client: PrismaClient; lastUsed: number };

@Injectable()
export class TenantPrismaPool implements OnModuleDestroy {
  private readonly log = new Logger(TenantPrismaPool.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxSize = 50;

  constructor(private readonly provisioning: TenantProvisioningService) {}

  get(dbName: string): PrismaClient {
    const hit = this.cache.get(dbName);
    if (hit) {
      hit.lastUsed = Date.now();
      return hit.client;
    }
    if (this.cache.size >= this.maxSize) this.evictOldest();
    const url = this.provisioning.buildTenantUrl(dbName);
    const client = new PrismaClient({ datasources: { db: { url } } });
    this.cache.set(dbName, { client, lastUsed: Date.now() });
    this.log.log(`Cached PrismaClient for tenant DB ${dbName}`);
    return client;
  }

  private evictOldest() {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of this.cache) {
      if (v.lastUsed < oldestTime) {
        oldestTime = v.lastUsed;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      this.cache.get(oldestKey)!.client.$disconnect().catch(() => {});
      this.cache.delete(oldestKey);
    }
  }

  async onModuleDestroy() {
    for (const [, v] of this.cache) await v.client.$disconnect().catch(() => {});
    this.cache.clear();
  }
}
