'use client';
import { useEffect, useId, useRef, type RefObject } from 'react';
import { X } from 'lucide-react';

/**
 * Accessible modal dialog.
 *
 * Behaviour notes (don't regress these — they fix real bugs):
 *
 * 1. The focus-trap effect deps are `[open]` ONLY. We hold the latest
 *    `onClose` in a ref so passing a fresh inline function from a parent
 *    that re-renders on every keystroke does NOT re-run the effect — which
 *    would otherwise cleanup-restore focus to the trigger button, then
 *    re-init focus to the first focusable inside (= the close button), so
 *    every keystroke yanks focus from the input to the X. (#focus-jump)
 *
 * 2. Initial focus order:
 *      a. `initialFocus` ref prop, if supplied
 *      b. element marked `data-autofocus`
 *      c. first form control (input / select / textarea) that isn't a
 *         checkbox / radio
 *      d. first focusable that isn't the close button (`data-modal-close`)
 *      e. the panel itself (so Esc / Tab still work)
 *
 * 3. The close button is rendered LAST in the panel's DOM but positioned
 *    absolutely top-right. Natural tab order then runs through every form
 *    field and footer button BEFORE hitting the close — matching every
 *    other modern dialog (Radix, Headless UI, native <dialog>).
 *
 * 4. We restore `body.overflow` to its previous value, not to `''`, so we
 *    don't clobber a `hidden` set by another active overlay (e.g. mobile
 *    nav drawer).
 */

const FOCUSABLE = [
  'a[href]', 'area[href]',
  'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', 'button:not([disabled])',
  'iframe', 'object', 'embed',
  '[contenteditable]', '[tabindex]:not([tabindex="-1"])',
].join(',');

const PREFERRED_INITIAL = [
  'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
].join(',');

export function Modal({
  open, onClose, title, children, footer, size = 'md', initialFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'md' | 'lg' | 'xl';
  /** Optional explicit initial focus target (winning over auto-detection). */
  initialFocus?: RefObject<HTMLElement | null>;
}) {
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  // Hold the latest onClose/initialFocus in refs so re-rendering parents with
  // fresh function or ref identities don't re-trigger the focus-trap effect.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const initialFocusRef = useRef(initialFocus);
  useEffect(() => { initialFocusRef.current = initialFocus; }, [initialFocus]);

  useEffect(() => {
    if (!open) return;

    lastFocused.current = (document.activeElement as HTMLElement) || null;
    const panel = panelRef.current;

    const focusInitial = () => {
      const fromProp = initialFocusRef.current?.current;
      if (fromProp) { fromProp.focus(); return; }
      if (!panel) return;
      const tagged = panel.querySelector<HTMLElement>('[data-autofocus]');
      if (tagged) { tagged.focus(); return; }
      const preferred = panel.querySelector<HTMLElement>(PREFERRED_INITIAL);
      if (preferred) { preferred.focus(); return; }
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => !el.hasAttribute('data-modal-close'));
      if (focusables.length) { focusables[0].focus(); return; }
      panel.focus();
    };
    // Defer one tick so any HTML `autoFocus` attribute wins first.
    const focusTimer = setTimeout(focusInitial, 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !panel) return;
      const targets = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (targets.length === 0) { e.preventDefault(); panel.focus(); return; }
      const first = targets[0];
      const last = targets[targets.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) { e.preventDefault(); last.focus(); }
      } else {
        if (active === last) { e.preventDefault(); first.focus(); }
      }
    };

    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      try { lastFocused.current?.focus(); } catch {}
    };
  }, [open]);

  if (!open) return null;
  const maxW = { md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size];

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-ink-900/30 animate-fade-in backdrop-blur-sm sm:items-center sm:p-4"
      onClick={() => onCloseRef.current()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className={`relative flex w-full ${maxW} max-h-screen flex-col bg-white shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 sm:max-h-[70vh] sm:animate-slide-up sm:rounded-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-ink-100 px-4 py-3.5 sm:px-5">
          {/* `pr-12` reserves space for the absolute-positioned close button so
              long titles never run under it. */}
          <h2 id={headingId} className="truncate pr-12 text-base font-semibold tracking-tight text-ink-900">{title}</h2>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-ink-100 bg-ink-50/50 px-4 py-3 sm:px-5">
            {footer}
          </div>
        )}
        {/* Close button is rendered LAST in DOM (so natural tab order reaches
            every form field first) but visually pinned top-right via
            absolute positioning. `data-modal-close` lets `focusInitial`
            skip it so opening the dialog never lands focus on the X. */}
        <button
          type="button"
          aria-label="Close dialog"
          data-modal-close
          onClick={() => onCloseRef.current()}
          className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
