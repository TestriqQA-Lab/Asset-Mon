import { Global, Injectable, Logger, Module } from '@nestjs/common';
import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import * as nodemailer from 'nodemailer';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { assertSafeOutboundUrl } from '../common/url-safety';

/**
 * POST to a URL while pinning the TCP connection to a pre-validated IP address.
 * The custom `lookup` makes Node connect to exactly `address` (no second DNS
 * resolution), while the Host header and TLS SNI still use the URL's hostname.
 * Node's http/https do not follow redirects, so a 3xx is surfaced as a non-2xx status.
 */
function postToPinnedHost(
  target: URL,
  address: string,
  family: number,
  init: { headers: Record<string, string>; body: string; timeoutMs: number },
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const mod = target.protocol === 'https:' ? https : http;
    const req = mod.request(
      target,
      {
        method: 'POST',
        headers: { ...init.headers, 'content-length': Buffer.byteLength(init.body).toString() },
        lookup: (_hostname: string, options: any, cb: any) =>
          options && options.all ? cb(null, [{ address, family }]) : cb(null, address, family),
        timeout: init.timeoutMs,
      },
      (res) => {
        res.resume(); // drain & discard the response body
        res.on('end', () => resolve({ status: res.statusCode || 0 }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('Webhook request timed out')));
    req.on('error', reject);
    req.write(init.body);
    req.end();
  });
}

@Injectable()
export class MailerService {
  private readonly log = new Logger(MailerService.name);
  private transporter = this.buildTransporter();

  private buildTransporter() {
    if (process.env.SMTP_HOST) {
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: false,
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
    }
    // dev: stream transport (no real network)
    return nodemailer.createTransport({ streamTransport: true, newline: 'unix', buffer: true });
  }

  async send(to: string, subject: string, body: string) {
    try {
      const info = await this.transporter.sendMail({
        from: process.env.SMTP_FROM || 'AssetMon <no-reply@assetmon.local>',
        to, subject, text: body,
      });
      this.log.log(`Sent email to ${to}: ${subject}`);
      return { ok: true, info };
    } catch (e: any) {
      this.log.error(`Email send failed to ${to}: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }
}

@Injectable()
export class EventBusService {
  private readonly log = new Logger(EventBusService.name);

  constructor(
    private readonly ctx: TenantContextService,
    private readonly mailer: MailerService,
  ) {}

  /**
   * Fire an event into the tenant's event pipeline:
   *  - Queue webhook deliveries to all subscriptions matching the event
   *  - Optionally send emails (caller passes recipients)
   */
  async emit(event: string, payload: any, opts?: { emails?: Array<{ to: string; subject: string; body: string }> }) {
    if (!this.ctx.tenantId) return;
    const db = this.ctx.prisma();
    const hooks = await db.webhook.findMany({ where: { active: true, events: { has: event } } });
    for (const h of hooks) {
      const delivery = await db.webhookDelivery.create({
        data: { webhookId: h.id, event, payload, attempts: 0 },
      });
      // Fire & forget; do not block request.
      this.deliver(h, delivery.id, event, payload).catch(() => {});
    }
    if (opts?.emails?.length) {
      for (const m of opts.emails) {
        const res = await this.mailer.send(m.to, m.subject, m.body);
        await db.emailLog.create({
          data: { toEmail: m.to, subject: m.subject, body: m.body, sent: res.ok, error: res.ok ? null : (res as any).error },
        });
      }
    }
  }

  private async deliver(hook: any, deliveryId: string, event: string, payload: any) {
    const db = this.ctx.prisma();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ event, payload, timestamp });
    const sig = crypto.createHmac('sha256', hook.secret).update(timestamp + '.' + body).digest('hex');

    let attempts = 0;
    let lastError: string | null = null;
    let status: number | null = null;
    let succeeded = false;

    for (let i = 1; i <= 3 && !succeeded; i++) {
      attempts = i;
      try {
        // Re-validate AND pin the resolved IP on every attempt: we connect to the exact
        // address we just checked, so a rebind to an internal IP between the check and the
        // connect (DNS rebinding) cannot happen.
        const { url, address, family } = await assertSafeOutboundUrl(hook.url);
        const res = await postToPinnedHost(url, address, family, {
          headers: {
            'content-type': 'application/json',
            'x-assetmon-event': event,
            'x-assetmon-signature': `t=${timestamp},v1=${sig}`,
            'user-agent': 'AssetMon-Webhooks/1.0',
          },
          body,
          timeoutMs: 5000,
        });
        status = res.status;
        if (res.status >= 200 && res.status < 300) succeeded = true;
        else lastError = `HTTP ${res.status}`;
      } catch (e: any) {
        lastError = e.message;
      }
      if (!succeeded) await new Promise((r) => setTimeout(r, i * 500));
    }

    await db.webhookDelivery.update({
      where: { id: deliveryId },
      data: { attempts, status, lastError, succeededAt: succeeded ? new Date() : null },
    });
  }
}

@Global()
@Module({
  providers: [MailerService, EventBusService],
  exports: [MailerService, EventBusService],
})
export class EventsModule {}
