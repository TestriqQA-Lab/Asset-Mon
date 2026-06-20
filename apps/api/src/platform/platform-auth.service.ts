import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { CatalogPrismaService } from '../catalog/catalog-prisma.service';
import { PlatformAuditService } from './platform-audit.service';

const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuuC1jXrwzgQp1/Eu0XPLDC9D7K0qJ7lI2';
const BCRYPT_COST = Number(process.env.BCRYPT_COST || 12);
const LOCK_THRESHOLD = Number(process.env.LOGIN_LOCK_THRESHOLD || 5);
const LOCK_DURATION_MS = Number(process.env.LOGIN_LOCK_DURATION_MS || 15 * 60_000);

// Public-facing password policy: ≥10 chars, contains a letter and a digit.
// Returns null on pass, an end-user-safe error string on fail.
function validatePasswordPolicy(pw: string): string | null {
  if (!pw || pw.length < 10) return 'New password must be at least 10 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'New password must contain at least one letter and one digit.';
  return null;
}

// Operator-driven password setters (createAdmin / resetAdminPassword) MUST follow the
// same policy as the self-service change-password flow. Without this, a super-admin
// could provision an account with `12345678` and the new user could re-use it
// indefinitely. We throw with a BadRequest so callers see a 400.
function assertOperatorPasswordPolicy(pw: string) {
  const err = validatePasswordPolicy(pw);
  if (err) throw new BadRequestException(err);
}

interface LoginDto {
  email: string;
  password: string;
}
interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}
interface CreateAdminDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: 'SUPER_ADMIN' | 'SUPPORT';
}

@Injectable()
export class PlatformAuthService {
  private readonly log = new Logger(PlatformAuthService.name);

  constructor(
    private readonly catalog: CatalogPrismaService,
    private readonly jwt: JwtService,
    private readonly audit: PlatformAuditService,
  ) {}

  // Provisioning of the very first platform admin (and any later one) is
  // handled exclusively by the `npm run platform:bootstrap-admin` CLI on the
  // API host. There is intentionally no HTTP bootstrap path: that means there
  // is also no public way to discover whether the platform has been
  // initialised — the login form behaves identically before and after.

  async login(dto: LoginDto, _req?: any) {
    // TODO(security): enforce TOTP/2FA for SUPER_ADMIN before go-live.
    const email = dto.email.toLowerCase();
    const user = await this.catalog.platformUser.findUnique({ where: { email } });

    if (!user) {
      // Constant-time wrong-credentials path.
      await bcrypt.compare(dto.password || '', DUMMY_HASH);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.active) throw new UnauthorizedException('Account disabled');
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account temporarily locked. Try again later.');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.recordFailed(user);
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.catalog.platformUser.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string) {
    let payload: any;
    try {
      payload = this.jwt.verify(refreshToken, { secret: process.env.JWT_REFRESH_SECRET });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (!payload?.platform || !payload?.jti) throw new UnauthorizedException('Invalid refresh token');

    const seen = await this.catalog.platformRefreshTokenJti.findUnique({ where: { jti: payload.jti } }).catch(() => null);
    if (seen) {
      if (seen.reason !== 'logout') {
        // Theft → invalidate every outstanding session for this platform user.
        await this.catalog.platformUser.update({
          where: { id: payload.sub },
          data: { tokenVersion: { increment: 1 } },
        }).catch(() => {});
      }
      throw new UnauthorizedException('Refresh token reused');
    }

    const user = await this.catalog.platformUser.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) throw new UnauthorizedException();

    await this.catalog.platformRefreshTokenJti.create({
      data: {
        jti: payload.jti,
        userId: payload.sub,
        reason: 'refresh',
        expiresAt: new Date((payload.exp || 0) * 1000),
      },
    }).catch(() => {});

    return this.issueTokens(user);
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return { ok: true };
    let payload: any;
    try { payload = this.jwt.verify(refreshToken, { secret: process.env.JWT_REFRESH_SECRET }); } catch { return { ok: true }; }
    if (!payload?.platform || !payload?.jti) return { ok: true };
    await this.catalog.platformRefreshTokenJti.upsert({
      where: { jti: payload.jti },
      update: { reason: 'logout' },
      create: {
        jti: payload.jti,
        userId: payload.sub,
        reason: 'logout',
        expiresAt: new Date((payload.exp || 0) * 1000),
      },
    }).catch(() => {});
    return { ok: true };
  }

  async logoutAll(userId: string) {
    await this.catalog.platformUser.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    }).catch(() => {});
    return { ok: true };
  }

  // ── Team management ─────────────────────────────────────────────────────
  // We intentionally hard-cap the team list at 500 rows. The platform team is
  // expected to stay below this for the foreseeable future, and the cap stops
  // a poisoned `?limit=` from being used to slowly dump the whole admin table
  // in a single request.
  async listAdmins(limit?: number) {
    const take = Math.max(1, Math.min(Number.isFinite(limit) ? Number(limit) : 100, 500));
    return this.catalog.platformUser.findMany({
      take,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, firstName: true, lastName: true, role: true,
        active: true, totpEnabled: true, lockedUntil: true, createdAt: true, updatedAt: true,
      },
    });
  }

  async createAdmin(actor: { id: string; email: string }, dto: CreateAdminDto, req?: any) {
    const email = dto.email.toLowerCase();
    assertOperatorPasswordPolicy(dto.password || '');
    if (await this.catalog.platformUser.findUnique({ where: { email } })) {
      throw new ConflictException('A platform user with that email already exists');
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    const user = await this.catalog.platformUser.create({
      data: {
        email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role || 'SUPPORT',
        passwordChangedAt: new Date(),
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, active: true, createdAt: true },
    });
    await this.audit.record(actor, 'platformUser.create', { type: 'platformUser', id: user.id }, { email }, req);
    return user;
  }

  async updateAdmin(actor: { id: string; email: string }, id: string, patch: Partial<{ firstName: string; lastName: string; role: 'SUPER_ADMIN' | 'SUPPORT'; active: boolean }>, req?: any) {
    const user = await this.catalog.platformUser.findUnique({ where: { id } });
    if (!user) throw new NotFoundException();

    // Prevent leaving the platform with zero active super-admins.
    if (patch.role && patch.role !== 'SUPER_ADMIN' && user.role === 'SUPER_ADMIN') {
      const others = await this.catalog.platformUser.count({ where: { role: 'SUPER_ADMIN', active: true, NOT: { id } } });
      if (others === 0) throw new ConflictException('Cannot demote the only active super-admin');
    }
    if (patch.active === false && user.role === 'SUPER_ADMIN') {
      const others = await this.catalog.platformUser.count({ where: { role: 'SUPER_ADMIN', active: true, NOT: { id } } });
      if (others === 0) throw new ConflictException('Cannot disable the only active super-admin');
    }

    // A role change or deactivation immediately invalidates outstanding tokens.
    const tvBump = (patch.role && patch.role !== user.role) || patch.active === false ? 1 : 0;
    const updated = await this.catalog.platformUser.update({
      where: { id },
      data: {
        firstName: patch.firstName ?? user.firstName,
        lastName: patch.lastName ?? user.lastName,
        role: patch.role ?? user.role,
        active: patch.active ?? user.active,
        tokenVersion: tvBump ? { increment: 1 } : undefined,
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, active: true, updatedAt: true },
    });
    await this.audit.record(actor, 'platformUser.update', { type: 'platformUser', id }, patch, req);
    return updated;
  }

  async resetAdminPassword(actor: { id: string; email: string }, id: string, newPassword: string, req?: any) {
    assertOperatorPasswordPolicy(newPassword || '');
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await this.catalog.platformUser.update({
      where: { id },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        tokenVersion: { increment: 1 },
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.audit.record(actor, 'platformUser.resetPassword', { type: 'platformUser', id }, {}, req);
    return { ok: true };
  }

  async deleteAdmin(actor: { id: string; email: string }, id: string, req?: any) {
    const user = await this.catalog.platformUser.findUnique({ where: { id } });
    if (!user) throw new NotFoundException();
    if (user.id === actor.id) throw new ConflictException('Refusing to delete yourself');
    if (user.role === 'SUPER_ADMIN') {
      const others = await this.catalog.platformUser.count({ where: { role: 'SUPER_ADMIN', active: true, NOT: { id } } });
      if (others === 0) throw new ConflictException('Cannot delete the only active super-admin');
    }
    await this.catalog.platformUser.delete({ where: { id } });
    await this.audit.record(actor, 'platformUser.delete', { type: 'platformUser', id: user.id }, { email: user.email }, req);
    return { ok: true };
  }

  // ── Self-service password change ────────────────────────────────────────
  /**
   * Authenticated platform user changes their own password. Wrong-current-
   * password attempts increment the same lockout counters that login uses, so
   * an attacker who has briefly captured an access token can't brute-force the
   * password. On success we bump tokenVersion; the caller's tab is told to
   * re-login so all other open sessions die immediately.
   */
  async changePassword(actor: { id: string; email: string }, dto: ChangePasswordDto, req?: any) {
    const user = await this.catalog.platformUser.findUnique({ where: { id: actor.id } });
    if (!user || !user.active) throw new UnauthorizedException();
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      // Generic — don't reveal lockout state vs bad password.
      throw new UnauthorizedException();
    }

    const ok = await bcrypt.compare(dto.currentPassword || '', user.passwordHash);
    if (!ok) {
      await this.recordFailed(user);
      throw new UnauthorizedException();
    }

    const policyError = validatePasswordPolicy(dto.newPassword);
    if (policyError) throw new BadRequestException(policyError);

    if (await bcrypt.compare(dto.newPassword, user.passwordHash)) {
      throw new BadRequestException('New password must be different from the current password.');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_COST);
    await this.catalog.platformUser.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        tokenVersion: { increment: 1 },
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.audit.record(actor, 'platform.account.password_changed', { type: 'platformUser', id: user.id }, {}, req);
    return { ok: true };
  }

  // ── Internals ───────────────────────────────────────────────────────────
  private async recordFailed(user: any) {
    const newCount = (user.failedLoginCount || 0) + 1;
    const shouldLock = newCount >= LOCK_THRESHOLD;
    await this.catalog.platformUser.update({
      where: { id: user.id },
      data: {
        failedLoginCount: shouldLock ? 0 : newCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : user.lockedUntil,
      },
    }).catch(() => {});
  }

  private issueTokens(user: { id: string; email: string; role: string; tokenVersion: number; firstName: string; lastName: string }) {
    const base = { sub: user.id, email: user.email, role: user.role, platform: true, tv: user.tokenVersion };
    const access = this.jwt.sign(base, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: Number(process.env.JWT_ACCESS_TTL || 900),
    });
    const jti = crypto.randomUUID();
    const refresh = this.jwt.sign(
      { sub: user.id, jti, platform: true, tv: user.tokenVersion },
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: Number(process.env.JWT_REFRESH_TTL || 2592000) },
    );
    return {
      accessToken: access,
      refreshToken: refresh,
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
    };
  }
}
