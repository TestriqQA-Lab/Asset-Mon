import './globals.css';
import { Inter } from 'next/font/google';
import { Providers } from './providers';
import { Toaster } from 'sonner';
import { pageMetadata } from '@/lib/seo';
import { SITE } from '@/lib/site';
import { ThemeBootstrap } from '@/components/ThemeBootstrap';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata = pageMetadata({
  title: `${SITE.name} · ${SITE.tagline}`,
  description: SITE.description,
  path: '/',
});

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b1020',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is required, not cosmetic. ThemeBootstrap below
    // writes the cached palette onto <html> BEFORE React hydrates, so the
    // client always has a `style` attribute the server could not have known
    // about — the theme lives in localStorage. React would otherwise report a
    // mismatch on every themed page load and drown out real ones.
    //
    // This suppresses only <html>'s own attributes, one level deep. Mismatches
    // inside the page are still reported.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Read the cached theme out of localStorage and apply the resolved CSS
            variables onto :root BEFORE React hydrates. Stops dashboards loading
            with the default palette and snapping to the tenant's preset 200ms
            later. The marketing site renders the same script — which simply
            no-ops when no cached theme exists. */}
        <ThemeBootstrap />
      </head>
      {/* Browser extensions routinely inject attributes into <body> before
          React loads (password managers, writing assistants, tab tools), which
          React then reports as a hydration mismatch on the developer's machine
          only. We render <body> with a fixed className and set nothing on it
          dynamically — the scroll locks elsewhere touch style.overflow inside
          useEffect, which runs after hydration and is never compared — so there
          is no real mismatch this could hide. */}
      <body className="min-h-screen bg-ink-50 text-ink-900 antialiased" suppressHydrationWarning>
        <Providers>
          {children}
          <Toaster richColors closeButton position="top-right" />
        </Providers>
      </body>
    </html>
  );
}
