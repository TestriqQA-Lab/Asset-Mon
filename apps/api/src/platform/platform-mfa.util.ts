/**
 * Pure helpers for the platform MFA flows. Kept DI-free so both
 * PlatformAuthService and PlatformMfaService can use them without a circular
 * dependency.
 */

/** True only when EVERY enrolment factor AND the final gate column are set. */
export function mfaSetupComplete(u: {
  primaryEmailVerifiedAt?: Date | null;
  totpEnabled?: boolean | null;
  totpSecret?: string | null;
  recoveryEmail?: string | null;
  recoveryEmailVerifiedAt?: Date | null;
  backupCodesGeneratedAt?: Date | null;
  mfaEnrolledAt?: Date | null;
}): boolean {
  return !!(
    u.primaryEmailVerifiedAt &&
    u.totpEnabled &&
    u.totpSecret &&
    u.recoveryEmail &&
    u.recoveryEmailVerifiedAt &&
    u.backupCodesGeneratedAt &&
    u.mfaEnrolledAt
  );
}

/** Mask an email for display: "ab****@domain.com". Never reveal the full local part. */
export function maskEmail(email: string): string {
  const [local, domain] = (email || '').split('@');
  if (!domain) return '***';
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'*'.repeat(Math.max(1, local.length - head.length))}@${domain}`;
}

function domainOf(email: string): string {
  const i = (email || '').lastIndexOf('@');
  return i >= 0 ? email.slice(i + 1).toLowerCase() : '';
}

/**
 * True if two emails share the same domain. Approximation of a registrable-domain
 * (eTLD+1) check — good enough to nudge operators toward a different provider for
 * their recovery email; it only drives a warning, never a hard block.
 */
export function sameRegistrableDomain(a: string, b: string): boolean {
  const da = domainOf(a);
  const db = domainOf(b);
  return !!da && da === db;
}
