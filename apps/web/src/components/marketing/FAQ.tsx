'use client';
import { useState } from 'react';
import { Plus, Minus, Search, Sparkles, ShieldCheck, CreditCard, Plug, Boxes } from 'lucide-react';

export type FaqItem = { q: string; a: string; category: FaqCategory };
export type FaqCategory = 'Getting started' | 'Security & data' | 'Pricing & trial' | 'Integrations' | 'Platform';

const ICON: Record<FaqCategory, React.ReactNode> = {
  'Getting started': <Sparkles className="h-3.5 w-3.5" />,
  'Security & data': <ShieldCheck className="h-3.5 w-3.5" />,
  'Pricing & trial': <CreditCard className="h-3.5 w-3.5" />,
  'Integrations': <Plug className="h-3.5 w-3.5" />,
  'Platform': <Boxes className="h-3.5 w-3.5" />,
};

export function FAQ({ items }: { items: FaqItem[] }) {
  const cats = Array.from(new Set(items.map((i) => i.category))) as FaqCategory[];
  const [active, setActive] = useState<FaqCategory>(cats[0]);
  const [q, setQ] = useState('');
  const filtered = items.filter((i) =>
    (active === i.category || q) &&
    (q ? (i.q + ' ' + i.a).toLowerCase().includes(q.toLowerCase()) : true),
  );

  return (
    <section id="faq" aria-labelledby="faq-heading" className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-3xl text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 py-1 text-xs text-ink-600 shadow-soft">
          <Sparkles className="h-3 w-3 text-brand-600" /> FAQ
        </div>
        <h2 id="faq-heading" className="mt-4 text-balance text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
          Answers, fast.
        </h2>
        <p className="mt-3 text-balance text-base text-ink-500">
          Hop into a category, or just search what's on your mind.
        </p>
      </div>

      <div className="mx-auto mt-8 max-w-3xl">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            type="search"
            aria-label="Search FAQs"
            placeholder="Search FAQs (e.g. 'data export', 'trial', 'SSO')"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-xl border border-ink-200 bg-white py-3 pl-9 pr-4 text-sm text-ink-900 placeholder:text-ink-400 shadow-card focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </div>

        {!q && (
          <div role="tablist" className="mt-4 flex flex-wrap gap-1.5">
            {cats.map((c) => {
              const on = active === c;
              return (
                <button
                  key={c}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setActive(c)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${on
                    ? 'bg-ink-900 text-white shadow-soft'
                    : 'border border-ink-200 bg-white text-ink-600 hover:bg-ink-50'}`}
                >
                  {ICON[c]} {c}
                </button>
              );
            })}
          </div>
        )}

        <ul role="list" className="mt-6 space-y-3">
          {filtered.length === 0 && (
            <li className="rounded-xl border border-dashed border-ink-200 bg-white p-6 text-center text-sm text-ink-500">
              Nothing matched. Try a different keyword or clear the search.
            </li>
          )}
          {filtered.map((it, i) => <FaqRow key={it.q + i} item={it} />)}
        </ul>
      </div>
    </section>
  );
}

function FaqRow({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card transition-all hover:border-ink-300">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left"
      >
        <span className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200">
            {ICON[item.category]}
          </span>
          <span>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-400">{item.category}</span>
            <span className="mt-0.5 block text-sm font-medium text-ink-900">{item.q}</span>
          </span>
        </span>
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-ink-200 bg-white text-ink-500">
          {open ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        </span>
      </button>
      {open && (
        <div className="border-t border-ink-100 bg-ink-50/40 px-5 py-4 text-sm leading-relaxed text-ink-700 animate-slide-up">
          {item.a}
        </div>
      )}
    </li>
  );
}
