/**
 * 單據明細中「參照號碼」欄位的顯示名稱，依排放源而異：
 *   電力(2-1) → 電表號碼；外購水(3-1-E) → 水表號；其他 → 發票號
 * 實際仍存於 activity_line_items.erp_ref。
 */
export function refLabel(sourceCode: string | undefined | null): string {
  const c = sourceCode ?? '';
  if (c.startsWith('2-1')) return '電表號碼';
  if (c === '3-1-E') return '水表號';
  return '發票號';
}
