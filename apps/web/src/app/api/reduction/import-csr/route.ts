import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { query } from '@/lib/db';
import { CSR_ENERGY_MAP } from '@/lib/reduction-types';
import { runAnomalyRules } from '@/lib/anomaly/engine';

// ─────────────────────────────────────────────────────────────────
// POST /api/reduction/import-csr
//   上傳 CSR_Detail 匯出（Data 工作表，逐廠逐月；車用/非車用柴汽油已分欄）
//   → 覆寫該年度 csr_energy（能源）與 csr_production（標打產能）。
//   煤、天然氣、生質燃料依指示不匯入；廢布(1-1A-9) 需先於平台補係數才算得出。
// ─────────────────────────────────────────────────────────────────

// CSR_Detail「Data」欄位索引（0-based）
const COL = {
  country: 0,
  factory: 1,
  month: 2,
  production: 4,
  electricity: 6,
  solar: 7,
  diesel_vehicle: 9,
  diesel_nonvehicle: 10,
  gasoline_vehicle: 12,
  gasoline_nonvehicle: 13,
  lpg: 15,
  wood: 16,
  fabric: 17,
} as const;

// CSR 能源欄 → CSR_ENERGY_MAP 的 key
const COL_TO_MAPKEY: Array<[number, keyof typeof CSR_ENERGY_MAP]> = [
  [COL.electricity, 'electricity'],
  [COL.solar, 'solar'],
  [COL.diesel_vehicle, 'diesel_vehicle'],
  [COL.diesel_nonvehicle, 'diesel_nonvehicle'],
  [COL.gasoline_vehicle, 'gasoline_vehicle'],
  [COL.gasoline_nonvehicle, 'gasoline_nonvehicle'],
  [COL.lpg, 'lpg'],
  [COL.wood, 'wood'],
  [COL.fabric, 'fabric'],
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// CSR 各廠本地名 → 平台 factory_code 對照已移入 DB（factory_csr_aliases，V32），
// 由 /admin/factories 維護，新增或改廠不必再改這支程式。
//   key = `${csr_country}|${csr_factory}`，多個 CSR 廠可對到同一平台廠（合併廠），匯入時加總。
//   is_ignored = 刻意略過（已關廠等）。與「漏設定」區分開來：前者靜默，後者列入警告，
//   否則兩者都只是「不在對照表裡」，漏設定會被靜默吃掉而無從察覺。
interface CsrAlias { factory_code: string | null; is_ignored: boolean }

async function loadCsrAliases(): Promise<Map<string, CsrAlias>> {
  const res = await query(
    `SELECT csr_country, csr_factory, factory_code, is_ignored FROM factory_csr_aliases`,
  );
  const map = new Map<string, CsrAlias>();
  for (const r of res.rows) {
    map.set(`${r.csr_country}|${r.csr_factory}`, { factory_code: r.factory_code, is_ignored: r.is_ignored });
  }
  return map;
}

function cellNum(sheet: XLSX.WorkSheet, r: number, c: number): number {
  const v = sheet[XLSX.utils.encode_cell({ r, c })]?.v;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
function cellStr(sheet: XLSX.WorkSheet, r: number, c: number): string {
  const v = sheet[XLSX.utils.encode_cell({ r, c })]?.v;
  return v == null ? '' : String(v).trim();
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try { form = await req.formData(); } catch {
    return NextResponse.json({ data: null, error: '需以 multipart/form-data 上傳' }, { status: 400 });
  }
  const file = form.get('file');
  const year = Number(form.get('year'));
  if (!(file instanceof File)) {
    return NextResponse.json({ data: null, error: '缺少檔案' }, { status: 400 });
  }
  if (!year || year < 2020 || year > 2100) {
    return NextResponse.json({ data: null, error: 'year 參數不正確' }, { status: 400 });
  }

  let sheet: XLSX.WorkSheet;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets['Data'] ?? wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('no sheet');
    sheet = ws;
  } catch {
    return NextResponse.json({ data: null, error: '無法讀取 Excel（需 CSR_Detail 的 Data 工作表）' }, { status: 400 });
  }

  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:A1');
  const warnings: string[] = [];
  const unmapped = new Set<string>();   // 查無對照設定 → 要讓使用者知道
  const csrAliases = await loadCsrAliases();
  let curCountry = '';
  let energyRows = 0;
  let prodRows = 0;

  // 全年快照：先清掉該年度既有 CSR 資料，再重建（避免舊格式 month=0 與新逐月重複計）
  await query('DELETE FROM csr_energy WHERE year = $1', [year]);
  await query('DELETE FROM csr_production WHERE year = $1', [year]);

  for (let r = 2; r <= range.e.r; r++) {
    const countryCell = cellStr(sheet, r, COL.country);
    if (countryCell) curCountry = countryCell;
    const factory = cellStr(sheet, r, COL.factory);
    if (!factory || factory === 'Sub-Total' || factory === 'Total') continue;

    const month = MONTHS[cellStr(sheet, r, COL.month).toLowerCase().slice(0, 3)];
    if (!month) continue; // 非月份列（合計等）略過

    const key = `${curCountry}|${factory}`;
    const alias = csrAliases.get(key);
    if (!alias) { unmapped.add(key); continue; }             // 對照表查無設定 → 列入警告
    if (alias.is_ignored || !alias.factory_code) continue;   // 刻意略過，不打擾使用者
    const platformCode = alias.factory_code;

    const production = cellNum(sheet, r, COL.production);
    if (production) {
      await query(
        `INSERT INTO csr_production (factory_code, year, month, standard_units)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (factory_code, year, month)
         DO UPDATE SET standard_units = csr_production.standard_units + EXCLUDED.standard_units`,
        [platformCode, year, month, production],
      );
      prodRows++;
    }

    for (const [col, mapKey] of COL_TO_MAPKEY) {
      const val = cellNum(sheet, r, col);
      if (!val) continue;
      const { source_code, unit } = CSR_ENERGY_MAP[mapKey];
      await query(
        `INSERT INTO csr_energy (factory_code, year, month, source_code, activity_value, activity_unit)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (factory_code, year, month, source_code)
         DO UPDATE SET activity_value = csr_energy.activity_value + EXCLUDED.activity_value,
                       activity_unit = EXCLUDED.activity_unit`,
        [platformCode, year, month, source_code, val, unit],
      );
      energyRows++;
    }
  }

  if (unmapped.size) {
    warnings.push(
      `下列 CSR 廠別在對照表中查無設定，已略過：${[...unmapped].join('、')}。`
      + '若需匯入請到 /admin/factories 的「CSR 廠名對照」新增；若本就該略過，請設為「刻意略過」。',
    );
  }

  // CSR 匯入完成 → 觸發該年度異常比對重跑（GOV_CSR_GHG_MISMATCH 等）。
  // 該年度已整年 DELETE 重建，故不限廠別，重跑全部廠。失敗不影響匯入結果本身，只記警告。
  try {
    await runAnomalyRules(year);
  } catch (err) {
    console.error('[import-csr] 異常比對重跑失敗', err);
    warnings.push('CSR 匯入成功，但異常比對重跑失敗，請稍後手動觸發或聯絡開發');
  }

  return NextResponse.json({
    data: { year, energyRows, prodRows, warnings },
    error: null,
  });
}
