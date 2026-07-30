'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, Pill, QueryState, EmptyState } from '@/components/ui';
import { ArrowRight, CheckCircle2, ListChecks } from 'lucide-react';

type Sample = { id: string; primary: string; secondary: string };
type Check = { key: string; label: string; count: number; href: string; sample: Sample[] };

export default function DataQualityPage() {
  const q = useQuery({ queryKey: ['data-quality'], queryFn: () => api<{ checks: Check[] }>('/data-quality') });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">Data quality</h1>
        <p className="text-sm text-ink-500">Gaps worth cleaning up across your workspace.</p>
      </div>

      <QueryState query={q}>
        {(data: { checks: Check[] }) => {
          const total = data.checks.reduce((n, c) => n + c.count, 0);
          if (total === 0) {
            return <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="All clear" description="No data-quality issues found — nice and tidy." />;
          }
          return (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {data.checks.map((c) => (
                <Card key={c.key}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                      <ListChecks className="h-4 w-4 text-ink-400" /> {c.label}
                    </h2>
                    <Pill tone={c.count === 0 ? 'green' : c.count > 20 ? 'red' : 'amber'}>{c.count}</Pill>
                  </div>
                  {c.count === 0 ? (
                    <p className="text-xs text-ink-400">None — all good.</p>
                  ) : (
                    <>
                      <ul className="space-y-0.5 text-xs text-ink-600">
                        {c.sample.map((s) => (
                          <li key={s.id} className="truncate">
                            <span className="font-medium text-ink-800">{s.primary}</span>
                            {s.secondary ? <span className="text-ink-400"> · {s.secondary}</span> : null}
                          </li>
                        ))}
                        {c.count > c.sample.length && <li className="text-ink-400">…and {c.count - c.sample.length} more</li>}
                      </ul>
                      <Link href={c.href} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                        View all <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </>
                  )}
                </Card>
              ))}
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
