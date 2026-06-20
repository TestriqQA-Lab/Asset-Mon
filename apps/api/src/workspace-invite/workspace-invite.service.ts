import { Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { CatalogPrismaService } from '../catalog/catalog-prisma.service';

// The DB column `inviteToken` now stores the HMAC of the real token rather than the
// raw secret, so a catalog-DB leak does not immediately leak usable invite links.
// We use HMAC-SHA-256 keyed on JWT_ACCESS_SECRET as a server-side pepper.
function hashToken(raw: string): string {
  return crypto
    .createHmac('sha256', process.env.JWT_ACCESS_SECRET || 'invite-pepper')
    .update(raw)
    .digest('hex');
}

// Plaintext tokens are only kept in memory long enough for the issuing admin to copy them.
// A small in-memory map indexed by tenantId remembers the latest issued plaintext so
// repeated reads from the dashboard return the same shareable link.
const plaintextCache = new Map<string, { token: string; hash: string }>();

@Injectable()
export class WorkspaceInviteService {
  constructor(private readonly catalog: CatalogPrismaService) {}

  private newToken() {
    return crypto.randomBytes(24).toString('base64url');
  }

  async getOrCreate(tenantId: string) {
    const t = await this.catalog.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Workspace not found');
    if (t.inviteToken) {
      // If we still hold the plaintext for this hash from a recent issuance, return it.
      const cached = plaintextCache.get(tenantId);
      if (cached && cached.hash === t.inviteToken) return { token: cached.token, enabled: true };
      // Otherwise return the hash placeholder so the UI can prompt for a rotation;
      // we never recover plaintext from a hash.
      return { token: null, enabled: true, needsRotation: true };
    }
    return this.rotate(tenantId);
  }

  async rotate(tenantId: string) {
    const raw = this.newToken();
    const hash = hashToken(raw);
    await this.catalog.tenant.update({ where: { id: tenantId }, data: { inviteToken: hash } });
    plaintextCache.set(tenantId, { token: raw, hash });
    return { token: raw, enabled: true };
  }

  async disable(tenantId: string) {
    await this.catalog.tenant.update({ where: { id: tenantId }, data: { inviteToken: null } });
    plaintextCache.delete(tenantId);
    return { token: null, enabled: false };
  }

  async findTenantByToken(token: string) {
    if (!token) return null;
    const hash = hashToken(token);
    return this.catalog.tenant.findUnique({ where: { inviteToken: hash } });
  }
}
