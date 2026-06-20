'use client';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false },
      mutations: {
        // Per-mutation onError takes precedence over the default. Pages that already
        // call toast.error in their own onError handler will still fire that one;
        // this fires only if no per-mutation onError is supplied.
        onError: (err: any) => {
          if (err?.message) toast.error(err.message);
        },
      },
    },
    mutationCache: new MutationCache({
      onError: (err: any, _vars, _ctx, mutation) => {
        // Don't double-toast if the page already supplied an onError handler.
        if (mutation.options.onError) return;
        if (err?.message) toast.error(err.message);
      },
    }),
  }));
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
