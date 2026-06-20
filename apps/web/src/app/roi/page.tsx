'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Calculator, ArrowRight, TrendingUp, Sparkles } from 'lucide-react';
import { MarketingShell } from '@/components/marketing/Shell';

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export default function RoiPage() {
  const [employees, setEmployees] = useState(100);
  const [assetsPerEmp, setAssetsPerEmp] = useState(2.5);
  const [avgCost, setAvgCost] = useState(1500);
  const [lossPct, setLossPct] = useState(2);
  const [audit, setAudit] = useState(6);

  const m = useMemo(() => {
    const totalAssets = employees * assetsPerEmp;
    const fleetValue = totalAssets * avgCost;
    // Lost-asset cost: replacement + ~5x indirect (data, productivity, comp)
    const lossDirect = (fleetValue * lossPct) / 100;
    const lossIndirect = lossDirect * 5;
    const lossTotal = lossDirect + lossIndirect;
    // Manual audit cost: audit hours/qtr × $50 loaded × 4 quarters
    const auditCost = audit * 50 * 4;
    // Over-deployment / license waste: rule of thumb 8% of fleet on software licenses
    const licenseWaste = totalAssets * 60; // ~$60/yr saved per asset on license reconciliation
    const total = lossTotal + auditCost + licenseWaste;
    // AssetMon saves a conservative 60% of this
    const savings = total * 0.6;
    const assetMonCost = employees * 12 * 8; // $8/user/mo
    const net = savings - assetMonCost;
    const roi = assetMonCost > 0 ? (net / assetMonCost) * 100 : 0;
    return { totalAssets, fleetValue, lossTotal, auditCost, licenseWaste, total, savings, assetMonCost, net, roi };
  }, [employees, assetsPerEmp, avgCost, lossPct, audit]);

  return (
    <MarketingShell>
      <section className="relative overflow-hidden border-b border-ink-100">
        <div aria-hidden className="absolute inset-0 bg-mesh opacity-70" />
        <div className="relative mx-auto max-w-4xl px-6 py-16 text-center">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white/70 px-3 py-1 text-xs text-ink-600 shadow-soft backdrop-blur">
            <Calculator className="h-3 w-3 text-brand-600" /> ROI calculator
          </p>
          <h1 className="mt-4 text-balance text-5xl font-semibold tracking-tight text-ink-900 sm:text-6xl">
            How much could you save with proper ITAM?
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-balance text-base text-ink-600">
            A back-of-envelope number based on industry benchmarks. Move the sliders.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-5 rounded-2xl border border-ink-200 bg-white p-6 shadow-card">
            <h2 className="text-lg font-semibold text-ink-900">Your team</h2>
            <Slider label="Employees" value={employees} min={5} max={2000} step={5} onChange={setEmployees} suffix="" />
            <Slider label="Assets per employee" value={assetsPerEmp} min={1} max={6} step={0.5} onChange={setAssetsPerEmp} suffix="" />
            <Slider label="Average asset cost" value={avgCost} min={300} max={4000} step={100} onChange={setAvgCost} prefix="$" />
            <Slider label="Annual loss / shrinkage rate" value={lossPct} min={0.5} max={8} step={0.5} onChange={setLossPct} suffix="%" />
            <Slider label="Hours spent on each audit cycle" value={audit} min={2} max={40} step={1} onChange={setAudit} suffix="h" />
          </div>

          <div className="space-y-4 rounded-2xl border border-ink-200 bg-gradient-to-br from-brand-50/40 to-white p-6 shadow-card">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-700">
              <TrendingUp className="h-3.5 w-3.5" /> Your numbers
            </div>
            <Row label="Total assets" value={m.totalAssets.toLocaleString()} />
            <Row label="Fleet acquisition value" value={fmt(m.fleetValue)} />
            <div className="my-2 border-t border-ink-100" />
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">Annual leakage</p>
            <Row label="Lost / unaccounted assets" value={fmt(m.lossTotal)} />
            <Row label="Manual audit labour" value={fmt(m.auditCost)} />
            <Row label="License waste / over-deployment" value={fmt(m.licenseWaste)} />
            <Row label="Total annual waste" value={fmt(m.total)} bold />

            <div className="mt-4 rounded-xl bg-ink-900 p-5 text-white">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-ink-300">AssetMon could save you</span>
                <span className="text-3xl font-semibold">{fmt(m.savings)}</span>
              </div>
              <div className="mt-2 flex items-baseline justify-between text-sm text-ink-300">
                <span>at a cost of</span>
                <span className="font-mono">{fmt(m.assetMonCost)}/yr</span>
              </div>
              <div className="mt-2 flex items-baseline justify-between border-t border-white/10 pt-2 text-sm">
                <span>Net</span>
                <span className="font-semibold text-emerald-400">{fmt(m.net)}</span>
              </div>
              <div className="mt-2 flex items-baseline justify-between text-sm">
                <span>ROI</span>
                <span className="font-semibold text-emerald-400">{m.roi.toFixed(0)}%</span>
              </div>
            </div>

            <Link href="/signup" className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink-900 text-sm font-semibold text-white shadow-soft hover:bg-ink-800">
              <Sparkles className="h-4 w-4" /> Start free trial · No card <ArrowRight className="h-4 w-4" />
            </Link>
            <p className="text-xs text-ink-400">
              Estimates use industry benchmarks (Gartner, ITAM Forum). Treat as directional, not a binding quote.
            </p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

function Slider({ label, value, min, max, step, onChange, suffix = '', prefix = '' }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; suffix?: string; prefix?: string }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-ink-700">{label}</span>
        <span className="font-mono text-sm text-ink-900">{prefix}{value.toLocaleString()}{suffix}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-2 w-full cursor-pointer appearance-none rounded-full bg-ink-100 accent-brand-600"
      />
    </label>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between text-sm ${bold ? 'border-t border-ink-100 pt-2 font-semibold text-ink-900' : 'text-ink-700'}`}>
      <span className={bold ? '' : 'text-ink-500'}>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
