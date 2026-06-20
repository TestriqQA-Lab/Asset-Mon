import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import type { PlanKey } from './plans';

@Injectable()
export class RazorpayService {
  private readonly log = new Logger(RazorpayService.name);
  private client: Razorpay | null = null;
  private get enabled() { return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET); }

  constructor() {
    if (this.enabled) {
      this.client = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID!,
        key_secret: process.env.RAZORPAY_KEY_SECRET!,
      });
      this.log.log('Razorpay client initialized');
    } else {
      this.log.warn('Razorpay keys missing — running in dev-mode (no real charges)');
    }
  }

  isEnabled() { return this.enabled; }

  planIdFor(plan: PlanKey): string | null {
    if (plan === 'business') return process.env.RAZORPAY_PLAN_BUSINESS || null;
    if (plan === 'enterprise') return process.env.RAZORPAY_PLAN_ENTERPRISE || null;
    return null;
  }

  async createCustomer(input: { email: string; name?: string }) {
    if (!this.client) throw new Error('Razorpay disabled');
    return this.client.customers.create({
      email: input.email,
      name: input.name,
      fail_existing: 0 as any, // re-use if a customer with this email already exists
    } as any);
  }

  async createSubscription(input: {
    planId: string; customerId?: string; quantity?: number;
    notes?: Record<string, string>; totalCount?: number;
  }) {
    if (!this.client) throw new Error('Razorpay disabled');
    return this.client.subscriptions.create({
      plan_id: input.planId,
      total_count: input.totalCount ?? 12,
      quantity: input.quantity ?? 1,
      customer_notify: 1,
      notes: input.notes,
      // customer_id is not always required — Razorpay collects on checkout if absent
      ...(input.customerId ? { customer_id: input.customerId } : {}),
    } as any);
  }

  async cancelSubscription(subId: string, cancelAtCycleEnd = true) {
    if (!this.client) throw new Error('Razorpay disabled');
    return this.client.subscriptions.cancel(subId, cancelAtCycleEnd);
  }

  /**
   * Verify a webhook delivery. Razorpay signs with HMAC-SHA256 of the raw body using your webhook secret.
   * We compare in constant time.
   */
  verifyWebhook(rawBody: string, signature: string | undefined): boolean {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      this.log.warn('No RAZORPAY_WEBHOOK_SECRET set — refusing to process webhook');
      return false;
    }
    if (!signature) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(signature, 'hex');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}
