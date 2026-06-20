'use client';
// Back-compat shims that forward to the new UI kit.
export { Field, inputClass } from './ui';

// Older string-based button classes used in many pages.
// Mobile: 40px tall tap target; desktop: legacy 36px.
export const btnPrimary = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-ink-900 px-3.5 text-sm font-medium text-white shadow-soft transition-all hover:bg-ink-800 active:scale-[0.98] disabled:opacity-50 sm:h-9';
export const btnSecondary = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-ink-200 bg-white px-3.5 text-sm font-medium text-ink-700 shadow-soft transition-all hover:border-ink-300 hover:bg-ink-50 active:scale-[0.98] sm:h-9';
export const btnDanger = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-rose-600 px-3 text-sm font-medium text-white shadow-soft transition-all hover:bg-rose-700 active:scale-[0.98] sm:h-9';
