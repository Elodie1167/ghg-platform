import * as XLSX from 'xlsx';
const BASE = 'https://ghg-platform-d2jz.vercel.app';
for (const [code, name] of [['2-1-A', '電力'], ['1-2A-2', '柴油'], ['3-1-E', '外購水']]) {
  const buf = await (await fetch(`${BASE}/api/records/import/template?source_code=${encodeURIComponent(code)}&year=2026`)).arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const hdr = XLSX.utils.sheet_to_json(wb.Sheets['單據明細'], { header: 1 })[0] as string[];
  console.log(`${code} (${name}) 第7欄 = ${hdr[6]}`);
}
process.exit(0);
