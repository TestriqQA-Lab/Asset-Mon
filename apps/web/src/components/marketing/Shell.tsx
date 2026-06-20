import { MarketingHeader } from './Header';
import { MarketingFooter } from './Footer';

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-ink-900">
      <MarketingHeader />
      {children}
      <MarketingFooter />
    </div>
  );
}
