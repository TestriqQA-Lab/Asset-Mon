export type PlanKey = 'starter' | 'business' | 'enterprise';

export const PLANS: Record<PlanKey, {
  key: PlanKey;
  name: string;
  priceMonthly: number;
  currency: 'INR' | 'USD';
  perUser: boolean;
  limits: { users: number | null; assets: number | null };
  modules: 'all' | string[];
  description: string;
}> = {
  starter: {
    key: 'starter', name: 'Starter', priceMonthly: 0, currency: 'INR', perUser: false,
    limits: { users: 5, assets: 50 }, modules: ['assets', 'categories'],
    description: 'For small teams getting their first 50 assets under control.',
  },
  business: {
    key: 'business', name: 'Business', priceMonthly: 699, currency: 'INR', perUser: true,
    limits: { users: null, assets: null }, modules: 'all',
    description: 'Everything most teams need. 30-day free trial.',
  },
  enterprise: {
    key: 'enterprise', name: 'Enterprise', priceMonthly: 0, currency: 'INR', perUser: true,
    limits: { users: null, assets: null }, modules: 'all',
    description: 'Volume + on-prem options, SCIM, custom SLAs.',
  },
};

export function formatPlanPrice(plan: { priceMonthly: number; currency: 'INR' | 'USD'; perUser: boolean }) {
  if (plan.priceMonthly === 0) return 'Free';
  const symbol = plan.currency === 'INR' ? '₹' : '$';
  return `${symbol}${plan.priceMonthly}${plan.perUser ? '/user/mo' : '/mo'}`;
}
