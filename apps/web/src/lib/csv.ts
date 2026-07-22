// Client-side CSV export helpers — injection-safe.
//
// A cell that starts with = + - @ (or a tab/CR) is treated as a formula by
// Excel / Google Sheets, so we prefix it with a single quote; every cell is then
// wrapped in double quotes with embedded quotes doubled. Mirrors the server-side
// `escapeCsv` in assets.controller.ts and the audit page's `csvCell`.

export function csvCell(v: any): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export function toCsv(header: string[], rows: any[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
