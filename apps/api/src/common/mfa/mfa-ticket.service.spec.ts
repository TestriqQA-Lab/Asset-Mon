import { JwtService } from '@nestjs/jwt';
import { MfaTicketService, MFA_TICKET_PURPOSE } from './mfa-ticket.service';

describe('MfaTicketService', () => {
  const svc = new MfaTicketService(new JwtService({}));

  test('round-trips claims and stamps the purpose', () => {
    const t = svc.sign(MFA_TICKET_PURPOSE.PENDING, { scope: 'tenant', nonce: 'N1', sub: 'u1', tid: 't1' });
    const p = svc.verify(t, MFA_TICKET_PURPOSE.PENDING);
    expect(p.scope).toBe('tenant');
    expect(p.nonce).toBe('N1');
    expect(p.sub).toBe('u1');
    expect(p.tid).toBe('t1');
    expect(p.purpose).toBe(MFA_TICKET_PURPOSE.PENDING);
  });

  test('rejects a ticket consumed with the wrong purpose (no cross-flow replay)', () => {
    const t = svc.sign(MFA_TICKET_PURPOSE.PENDING, { scope: 'platform', nonce: 'N' });
    expect(() => svc.verify(t, MFA_TICKET_PURPOSE.SETUP)).toThrow();
  });

  test('rejects a tampered ticket', () => {
    const t = svc.sign(MFA_TICKET_PURPOSE.SETUP, { scope: 'platform' });
    expect(() => svc.verify(t + 'x', MFA_TICKET_PURPOSE.SETUP)).toThrow();
  });

  test('rejects an expired ticket', () => {
    const t = svc.sign(MFA_TICKET_PURPOSE.PENDING, { scope: 'platform', nonce: 'z' }, -1);
    expect(() => svc.verify(t, MFA_TICKET_PURPOSE.PENDING)).toThrow();
  });

  test('rejects a token signed with a different secret (dedicated secret, HS256 pinned)', () => {
    const foreign = new JwtService({}).sign(
      { scope: 'tenant', purpose: MFA_TICKET_PURPOSE.PENDING },
      { secret: 'a-totally-different-secret', algorithm: 'HS256' },
    );
    expect(() => svc.verify(foreign, MFA_TICKET_PURPOSE.PENDING)).toThrow();
  });
});
