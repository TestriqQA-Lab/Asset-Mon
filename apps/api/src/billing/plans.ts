export type PlanKey = 'starter' | 'business' | 'enterprise';

export const PLANS: Record<PlanKey, {
  key: PlanKey;
  name: string;
  priceMonthly: number;
  currency: 'INR' | 'USD';
  perUser: boolean;
  limits: { users: number | null; assets: number | null };
  modules: 'all' | string[];
}> = {
  starter:    { key: 'starter',    name: 'Starter',    priceMonthly: 0,    currency: 'INR', perUser: false, limits: { users: 5, assets: 50 }, modules: ['assets', 'categories'] },
  business:   { key: 'business',   name: 'Business',   priceMonthly: 699,  currency: 'INR', perUser: true,  limits: { users: null, assets: null }, modules: 'all' },
  enterprise: { key: 'enterprise', name: 'Enterprise', priceMonthly: 0,    currency: 'INR', perUser: true,  limits: { users: null, assets: null }, modules: 'all' },
};
