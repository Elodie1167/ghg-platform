import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

const path = '\\\\nt_pdc\\永續發展部\\外部使用檔\\10_Sustainability\\! 產區能源數據\\2026\\各區能源資訊\\CAB\\MOHA\\2. Electricity\\Electricity.xlsx';
const wb = XLSX.read(readFileSync(path), { type: 'buffer' }); // 不用 cellDates → 取原始序列值
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Electricity'], { header: 1, raw: true, defval: '' }) as unknown[][];
const H = rows[0].map((h) => String(h).trim());
const iYM = H.indexOf('Year-Month');
const iQty = H.indexOf('Quantity');
const iPO = H.indexOf('PO NO.');
console.log(`iYM=${iYM} iQty=${iQty} iPO=${iPO}`);
for (let r = 1; r < rows.length; r++) {
  const raw = rows[r][iYM];
  let ym = '—';
  if (typeof raw === 'number') {
    const d = new Date(Math.round((raw - 25569) * 86400 * 1000)); // Excel serial → UTC date
    ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  } else ym = String(raw);
  console.log(`Row${r}: PO=${rows[r][iPO]} | YM原始=${JSON.stringify(raw)} → 解析=${ym} | Qty=${rows[r][iQty]}`);
}
process.exit(0);
