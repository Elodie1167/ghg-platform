/** 驗證：Year-Month 為 Excel 日期的 ERP 檔能正確匯入（year 2095 隔離，跑完清除）。 */
import * as XLSX from 'xlsx';
const BASE = 'https://ghg-platform-d2jz.vercel.app';
const FID = '7f71c2aa-3f33-4c26-92f3-14a2c3fd6d4c'; // IND_DMK

const aoa: unknown[][] = [
  ['PO NO.', 'Year-Month', 'UoM', 'Quantity', 'CSR Key', 'Description'],
  ['PO-A', new Date(Date.UTC(2095, 0, 15)), 'KWH', 1000, 'K1', 'Jan'],
  ['PO-B', new Date(Date.UTC(2095, 1, 15)), 'KWH', 2000, 'K2', 'Feb'],
];
const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Electricity');
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

const fd = new FormData();
fd.append('factory_id', FID); fd.append('year', '2095'); fd.append('source_code', '2-1-A');
fd.append('file', new Blob([new Uint8Array(buf)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Electricity.xlsx');

const res = await fetch(`${BASE}/api/records/import-erp`, { method: 'POST', body: fd });
console.log('匯入:', res.status, JSON.stringify((await res.json()).data));
console.log('預期: lineItemsImported=2, months=[1,2], skipped=0');

// cleanup
const src = await (await fetch(`${BASE}/api/emission-sources`)).json();
const elec = src.data.find((s: { source_code: string }) => s.source_code === '2-1-A')?.id;
const recs = await (await fetch(`${BASE}/api/records?factory_id=${FID}&year=2095&emission_source_id=${elec}`)).json();
console.log('建立紀錄數:', (recs.data || []).length, '（預期 2：Jan、Feb）');
for (const r of recs.data || []) await fetch(`${BASE}/api/records/${r.id}`, { method: 'DELETE' });
console.log('已清除');
process.exit(0);
