/** @type {import('tailwindcss').Config} */

// Helper for var-backed colors so `<alpha-value>` modifiers (e.g. `bg-ink-900/40`)
// still work. Tokens emit both `--am-…` (hex) and `--am-…-rgb` ("R G B"); this
// reads the triplet form.
const v = (name) => `rgb(var(${name}-rgb) / <alpha-value>)`;

module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Refined neutrals — bound to the active theme's derived ink ramp.
        // Marketing pages are outside any `[data-themed]` scope so they
        // inherit the `default` preset's ramp (which matches the original
        // hard-coded values) and stay visually unchanged.
        ink: {
          DEFAULT: v('--am-ink-900'),
          50:  v('--am-ink-50'),
          100: v('--am-ink-100'),
          200: v('--am-ink-200'),
          300: v('--am-ink-300'),
          400: v('--am-ink-400'),
          500: v('--am-ink-500'),
          600: v('--am-ink-600'),
          700: v('--am-ink-700'),
          800: v('--am-ink-800'),
          900: v('--am-ink-900'),
        },
        // Brand ramp — derived from `--am-color-primary` per active preset.
        brand: {
          50:  v('--am-brand-50'),
          100: v('--am-brand-100'),
          200: v('--am-brand-200'),
          300: v('--am-brand-300'),
          400: v('--am-brand-400'),
          500: v('--am-brand-500'),
          600: v('--am-brand-600'),
          700: v('--am-brand-700'),
          800: v('--am-brand-800'),
          900: v('--am-brand-900'),
        },
        // Theme tokens (`bg-am-bg`, `text-am-heading`, `border-am-border`, …).
        // These are the names dashboard chrome reaches for directly; ink-* and
        // brand-* are kept for legacy markup that pre-dates the token system.
        am: {
          bg:             v('--am-color-bg'),
          surface:        v('--am-color-surface'),
          'surface-muted': v('--am-color-surface-muted'),
          border:         v('--am-color-border'),
          text:           v('--am-color-text'),
          'text-muted':   v('--am-color-text-muted'),
          heading:        v('--am-color-heading'),
          link:           v('--am-color-link'),
          primary:        v('--am-color-primary'),
          'primary-fg':   v('--am-color-primary-fg'),
          accent:         v('--am-color-accent'),
          success:        v('--am-color-success'),
          warning:        v('--am-color-warning'),
          danger:         v('--am-color-danger'),
          info:           v('--am-color-info'),
          data:           v('--am-color-data'),
        },
        accent: {
          DEFAULT: v('--am-color-accent'),
          50: '#ecfeff',
          500: '#06b6d4',
          600: '#0891b2',
        },
      },
      boxShadow: {
        'soft': '0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)',
        'card': '0 1px 2px 0 rgb(var(--am-overlay-rgb) / 0.04), 0 4px 24px -10px rgb(var(--am-overlay-rgb) / 0.10)',
        'pop':  '0 12px 32px -8px rgb(var(--am-overlay-rgb) / 0.16)',
        'glow': '0 0 0 1px rgb(var(--am-color-primary-rgb) / 0.4), 0 6px 16px -4px rgb(var(--am-color-primary-rgb) / 0.45)',
        'aurora': '0 10px 40px -10px rgb(var(--am-color-primary-rgb) / 0.6)',
      },
      borderRadius: { xl: '0.85rem', '2xl': '1rem' },
      keyframes: {
        'fade-in': { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        'slide-up': { '0%': { opacity: 0, transform: 'translateY(8px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        'pulse-soft': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.6 } },
        'blob': {
          '0%, 100%': { transform: 'translate(0px, 0px) scale(1)' },
          '33%': { transform: 'translate(40px, -30px) scale(1.1)' },
          '66%': { transform: 'translate(-20px, 30px) scale(0.95)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'gradient-shift': {
          '0%, 100%': { 'background-position': '0% 50%' },
          '50%': { 'background-position': '100% 50%' },
        },
        'marquee': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'glow-pulse': {
          '0%, 100%': { opacity: 0.4 },
          '50%': { opacity: 0.7 },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'slide-up': 'slide-up 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-soft': 'pulse-soft 1.6s ease-in-out infinite',
        'blob': 'blob 14s ease-in-out infinite',
        'blob-slow': 'blob 22s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
        'gradient-shift': 'gradient-shift 8s ease infinite',
        'marquee': 'marquee 30s linear infinite',
        'shimmer': 'shimmer 2.5s linear infinite',
        'glow-pulse': 'glow-pulse 4s ease-in-out infinite',
      },
      backgroundImage: {
        'mesh': 'radial-gradient(at 12% 10%, rgb(var(--am-color-primary-rgb) / 0.18) 0px, transparent 50%), radial-gradient(at 88% 0%, rgb(var(--am-color-accent-rgb) / 0.18) 0px, transparent 50%), radial-gradient(at 50% 100%, rgb(var(--am-color-data-rgb) / 0.15) 0px, transparent 50%)',
        'grid-light': 'linear-gradient(to right, rgb(var(--am-overlay-rgb) / 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--am-overlay-rgb) / 0.04) 1px, transparent 1px)',
        'aurora': 'linear-gradient(135deg, rgb(var(--am-color-primary-rgb) / 0.18), rgb(var(--am-color-accent-rgb) / 0.18) 45%, rgb(var(--am-color-data-rgb) / 0.18))',
      },
    },
  },
  plugins: [],
};
