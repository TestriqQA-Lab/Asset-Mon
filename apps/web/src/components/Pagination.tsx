'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 20;

type PaginationProps = {
  /** Total number of items (after any client-side filtering). */
  totalItems: number;
  /** Current 1-based page index. */
  page: number;
  /** Called when the user navigates to a different page. */
  onPageChange: (page: number) => void;
  /** Override the default page size (25). */
  pageSize?: number;
};

/**
 * Shared pagination bar used across tables. Shows "Page X of Y" with
 * previous / next buttons.  Designed to sit below a <table> or list.
 */
export function Pagination({ totalItems, page, onPageChange, pageSize = PAGE_SIZE }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);

  if (totalItems <= pageSize) return null; // single page — nothing to paginate

  const from = (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between border-t border-ink-100 px-4 py-2.5">
      <span className="text-xs text-ink-500">
        {from}–{to} of {totalItems}
      </span>

      <div className="flex items-center gap-1">
        <button
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-ink-200 bg-white text-ink-600 transition-colors hover:bg-ink-50 disabled:opacity-40 disabled:pointer-events-none"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[5rem] text-center text-xs font-medium text-ink-700">
          Page {safePage} of {totalPages}
        </span>
        <button
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-ink-200 bg-white text-ink-600 transition-colors hover:bg-ink-50 disabled:opacity-40 disabled:pointer-events-none"
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Slice an array by page index (1-based). */
export function paginate<T>(items: T[], page: number, pageSize = PAGE_SIZE): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
