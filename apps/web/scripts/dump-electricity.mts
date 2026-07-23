import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

const path = '\\\\nt_pdc\\永續發展部\\外部使用檔\\10_Sustainability\\! 產區能源數據\\2026\\各區能源資訊\\CAB\\MOHA\\2. Electricity\\Electricity.xlsx';

const buf = readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
console.log('Sheets:', wb.SheetNames);
for (const sn of wb.SheetNames.slice(0, 3)) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' }) as unknown[][];
  console.log(`\n=== Sheet: "${sn}"  (共 ${rows.length} 列) ===`);
  console.log('Header(row0):', JSON.stringify(rows[0]));
  for (let i = 1; i <= Math.min(5, rows.length - 1); i++) {
    console.log(`Row${i}:`, JSON.stringify(rows[i]));
  }
}
process.exit(0);
