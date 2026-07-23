/** 診斷：把 ERP 原生檔丟到「主匯入(①)」vs「ERP 直匯(②)」的差異。 */
import * as XLSX from 'xlsx';
const BASE = 'https://ghg-platform-d2jz.vercel.app';
const FID = '7f71c2aa-3f33-4c26-92f3-14a2c3fd6d4c';

// ERP 原生格式（分頁名 fnd_gfm，非範本命名）
const aoa = [
  ['PO NO.', 'Region', 'Apply DEPT.', 'Status', 'Year-Month', 'User Name', 'Item Name', 'UoM', 'Quantity', 'Amount', 'Tax Amount', 'Description', 'CSR Key', 'CSR Value'],
  ['CSR-VINMK1-209606-001', 'VIN', 'GA', 'Approved', '2096-06', 'X', 'Electric(電)', 'KWH', 29600, 0, 0, 'kỳ1', 10055902, 29600],
];
const ws = XLSX.utils.aoa_to_sheet(aoa);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'fnd_gfm');
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

// (1) 丟到主匯入
const fd1 = new FormData();
fd1.append('factory_id', FID); fd1.append('year', '2096');
fd1.append('file', new Blob([new Uint8Array(buf)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'erp.xlsx');
const r1 = await fetch(`${BASE}/api/records/import`, { method: 'POST', body: fd1 });
console.log('① 主匯入 ERP 檔:', r1.status, JSON.stringify((await r1.json()).data));

// (2) 丟到 ERP 直匯（選 2-1-A）
const fd2 = new FormData();
fd2.append('factory_id', FID); fd2.append('year', '2096'); fd2.append('source_code', '2-1-A');
fd2.append('file', new Blob([new Uint8Array(buf)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'erp.xlsx');
const r2 = await fetch(`${BASE}/api/records/import-erp`, { method: 'POST', body: fd2 });
console.log('② ERP 直匯:', r2.status, JSON.stringify((await r2.json()).data));

// cleanup year 2096
const src = await (await fetch(`${BASE}/api/emission-sources`)).json();
const elec = src.data.find((s: { source_code: string }) => s.source_code === '2-1-A')?.id;
const recs = await (await fetch(`${BASE}/api/records?factory_id=${FID}&year=2096&emission_source_id=${elec}`)).json();
for (const r of recs.data || []) await fetch(`${BASE}/api/records/${r.id}`, { method: 'DELETE' });
console.log('清除 2096 測試紀錄:', (recs.data || []).length, '筆');
process.exit(0);
