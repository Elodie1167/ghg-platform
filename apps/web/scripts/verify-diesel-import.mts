/** POC 驗證：建 3 張車用柴油(1-2A-2)單據 Excel → 匯入 → 驗證加總/明細/公檔連結 → 清除。year 2098 隔離。 */
import * as XLSX from 'xlsx';

const BASE = 'https://ghg-platform-d2jz.vercel.app';
const FID = '7f71c2aa-3f33-4c26-92f3-14a2c3fd6d4c'; // IND_DMK
const DOC = '\\\\公檔\\GHG\\1-2A-2\\2098\\06';

const aoa = [
  ['月份', '排放源代碼', '單據號碼', '單據日期', '用量', '單位', 'ERP參照', '備註', '公檔連結'],
  [6, '1-2A-2', 'PO-D-001', '2098-06-03', 120, 'L', 'CSR-1', '第一次加油', DOC],
  [6, '1-2A-2', 'PO-D-002', '2098-06-15', 95, 'L', 'CSR-2', '', ''],
  [6, '1-2A-2', 'PO-D-003', '2098-06-27', 80, 'L', 'CSR-3', '', ''],
];
const ws = XLSX.utils.aoa_to_sheet(aoa);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '單據明細');
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

const fd = new FormData();
fd.append('factory_id', FID);
fd.append('year', '2098');
fd.append('file', new Blob([new Uint8Array(buf)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'test.xlsx');

const imp = await fetch(`${BASE}/api/records/import`, { method: 'POST', body: fd });
console.log('匯入回應:', imp.status, JSON.stringify((await imp.json()).data));

const src = await (await fetch(`${BASE}/api/emission-sources`)).json();
const dieselId = src.data.find((s: { source_code: string }) => s.source_code === '1-2A-2')?.id;
const recs = await (await fetch(`${BASE}/api/records?factory_id=${FID}&year=2098&emission_source_id=${dieselId}`)).json();
console.log('紀錄:', (recs.data || []).map((r: { activity_value: number; co2e_total: number }) => ({ 用量: r.activity_value, co2e: r.co2e_total })));
console.log('預期: 用量=295 (120+95+80)');

const rid = recs.data?.[0]?.id;
if (rid) {
  const li = await (await fetch(`${BASE}/api/records/${rid}/line-items`)).json();
  console.log('明細筆數:', (li.data || []).length, '｜ 公檔連結:', li.source_doc_url);
  const del = await fetch(`${BASE}/api/records/${rid}`, { method: 'DELETE' });
  console.log('清除測試紀錄:', del.status);
}
process.exit(0);
