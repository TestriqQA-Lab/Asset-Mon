'use client';
import React from 'react';

export function LegalSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h2>
      <div className="mt-3 space-y-3 text-base leading-relaxed text-ink-700">{children}</div>
    </section>
  );
}

export function LegalShell({ title, lastUpdated, toc, children }: { title: string; lastUpdated: string; toc: { id: string; label: string }[]; children: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <div className="grid gap-10 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-24 rounded-xl border border-ink-200 bg-white p-4 shadow-soft">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">On this page</p>
            <ul className="mt-2 space-y-1.5 text-sm" role="list">
              {toc.map((t) => (
                <li key={t.id}><a href={`#${t.id}`} className="text-ink-600 hover:text-ink-900">{t.label}</a></li>
              ))}
            </ul>
          </div>
        </aside>
        <article>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Legal</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">{title}</h1>
          <p className="mt-2 text-sm text-ink-500">Last updated: {lastUpdated}</p>
          <div className="mt-8 space-y-10">{children}</div>
        </article>
      </div>
    </section>
  );
}
