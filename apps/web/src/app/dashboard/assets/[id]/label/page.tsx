'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getSession } from '@/lib/api';

export default function LabelPage() {
  const { id } = useParams() as { id: string };
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [asset, setAsset] = useState<any>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) return;
    const base = process.env.NEXT_PUBLIC_API_URL;
    fetch(`${base}/api/assets/${id}`, { headers: { Authorization: `Bearer ${s.accessToken}` } })
      .then((r) => r.json())
      .then(setAsset);
    fetch(`${base}/api/assets/${id}/qr`, { headers: { Authorization: `Bearer ${s.accessToken}` } })
      .then((r) => r.blob())
      .then((b) => setQrUrl(URL.createObjectURL(b)));
  }, [id]);

  if (!asset || !qrUrl) return <main className="p-6">Loading…</main>;

  return (
    <main className="bg-white p-8 print:p-0">
      <div className="mx-auto w-[3in] rounded border p-4 text-center print:border-0">
        <img src={qrUrl} alt="QR" className="mx-auto h-40 w-40" />
        <div className="mt-2 font-mono text-sm">{asset.assetTag}</div>
        <div className="text-xs">{asset.name}</div>
        {asset.serialNumber && <div className="text-[10px] text-gray-500">SN: {asset.serialNumber}</div>}
      </div>
      <div className="mt-6 text-center print:hidden">
        <button onClick={() => window.print()} className="rounded-md bg-brand-600 px-4 py-2 text-white hover:bg-brand-700">Print</button>
      </div>
    </main>
  );
}
