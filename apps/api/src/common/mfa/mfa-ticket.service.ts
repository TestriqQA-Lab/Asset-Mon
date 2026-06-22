import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * Signs/verifies the short-lived MFA tickets used across the platform + tenant
 * MFA flows. The ticket is only a SIGNED POINTER — all mutable chain state lives
 * in the *MfaPending DB row, located via `nonce` (which is rotated each step).
 *
 * Distinct `purpose` values are minted under one dedicated secret
 * (JWT_MFA_TICKET_SECRET, no fallback) and verified at the matching consumption
 * point, so a ticket cannot be replayed in the wrong flow. HS256 is pinned on
 * verify (no algorithm-confusion / "none" downgrade). The ticket is never an
 * access token and never carries `platform: true`.
 */

export const MFA_TICKET_PURPOSE = {
  PENDING: 'mfa_pending',
  SETUP: 'mfa_setup',
  STEP_UP: 'step_up',
} as const;

export interface MfaTicketClaims {
  scope: 'platform' | 'tenant';
  /**
   * Locates (and is rotated with) the *MfaPending row. Present for the login
   * chain; omitted for setup / step-up tickets, which carry no rotating nonce.
   */
  nonce?: string;
  /** userId — convenience only; the DB row is authoritative. */
  sub?: string;
  /** Tenant id (tenant scope only). */
  tid?: string;
  /** Tenant db name (tenant scope only). */
  db?: string;
  [k: string]: unknown;
}

@Injectable()
export class MfaTicketService {
  constructor(private readonly jwt: JwtService) {}

  private secret(): string {
    const s = process.env.JWT_MFA_TICKET_SECRET;
    if (!s) throw new Error('JWT_MFA_TICKET_SECRET is not set');
    return s;
  }

  /** Sign a ticket with the given purpose + claims, expiring in `ttlSeconds` (default 600 = 10 min). */
  sign(purpose: string, claims: MfaTicketClaims, ttlSeconds = 600): string {
    return this.jwt.sign(
      { ...claims, purpose },
      { secret: this.secret(), algorithm: 'HS256', expiresIn: ttlSeconds },
    );
  }

  /** Verify a ticket and assert it matches `expectedPurpose`. Throws MFA_RESTART on any failure. */
  verify(token: string, expectedPurpose: string): MfaTicketClaims & { purpose: string; exp: number } {
    let payload: any;
    try {
      payload = this.jwt.verify(token, { secret: this.secret(), algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException({ code: 'MFA_RESTART', message: 'Invalid or expired ticket' });
    }
    if (!payload || payload.purpose !== expectedPurpose) {
      throw new UnauthorizedException({ code: 'MFA_RESTART', message: 'Wrong ticket type' });
    }
    return payload;
  }
}
