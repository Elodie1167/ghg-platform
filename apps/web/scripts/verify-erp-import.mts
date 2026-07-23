/** POC 驗證：ERP 原生 tsv 直匯（source=2-1-A 電力，year 2097 隔離，混廠別前綴，跑完即清除）。 */
const BASE = 'https://ghg-platform-d2jz.vercel.app';
const FID = '7f71c2aa-3f33-4c26-92f3-14a2c3fd6d4c'; // IND_DMK

const tsv = [
  'PO NO.\tRegion\tApply DEPT.\tStatus\tYear-Month\tUser Name\tItem Name\tUoM\tQuantity\tAmount\tTax Amount\tDescription\tCSR Key\tCSR Value',
  'CSR-VINMK1-209706-001\tVIN\tGA\tApproved\t2097-06\tX\tElectric(電)\tKWH\t29600\t0\t0\tkỳ 1: 01/6-15/6\t10055902\t29600',
  'CSR-VINMKHO-209706-001\tVIN\tGA\tApproved\t2097-06\tX\tElectric(電)\tKWH\t328020\t0\t0\tkỳ 1: 1/6-10/6\t10055850\t328020',
].join('\n');

const fd = new FormData();
fd.append('factory_id', FID);
fd.append('year', '2097');
fd.append('source_code', '2-1-A');
fd.append('file', new Blob([tsv], { type: 'text/tab-separated-values' }), 'fnd_gfm.tsv');

const imp = await fetch(`${BASE}/api/records/import-erp`, { method: 'POST', body: fd });
console.log('ERP 匯入:', imp.status, JSON.stringify((await imp.json()).data));
console.log('預期: lineItemsImported=2, months=[6]（VINMK1 與 VINMKHO 混廠別皆歸 IND_DMK）');

const src = await (await fetch(`${BASE}/api/emission-sources`)).json();
const elecId = src.data.find((s: { source_code: string }) => s.source_code === '2-1-A')?.id;
const recs = await (await fetch(`${BASE}/api/records?factory_id=${FID}&year=2097&emission_source_id=${elecId}`)).json();
console.log('紀錄:', (recs.data || []).map((r: { activity_value: number; co2e_total: number }) => ({ 用量: r.activity_value, co2e: r.co2e_total })));
console.log('預期: 用量=357620 (29600+328020), co2e≈311.13 (357620/1000×0.87)');

const rid = recs.data?.[0]?.id;
if (rid) {
  const li = await (await fetch(`${BASE}/api/records/${rid}/line-items`)).json();
  console.log('明細筆數:', (li.data || []).length, '｜ 第一筆電表號碼(erp_ref):', li.data?.[0]?.erp_ref);
  const del = await fetch(`${BASE}/api/records/${rid}`, { method: 'DELETE' });
  console.log('清除:', del.status);
}
process.exit(0);
