// 異常提醒模組共用型別。規格見 異常提醒_規則設計.md v1.7。

export type Severity = 'blocking' | 'advisory';

export interface Flag {
  rule_code: string;
  severity: Severity;
  factory_code: string;
  year: number;
  month: number; // 0 = 年度層級
  subject_key: string; // bucket_key / source_code / '' 依規則而定
  record_id?: string | null;
  detail: Record<string, unknown>;
}

export interface FactoryRow {
  factory_code: string;
  name_zh: string;
  country_code: string;
}

// 一次規則掃描的上下文：限定廠別 + 年度（CSR 匯入回呼一次重跑整年）
export interface RuleContext {
  factories: FactoryRow[];
  year: number;
}

export interface Rule {
  code: string;
  // 這個 Rule 實作可能吐出的所有 rule_code（多數只有 code 自己一種；
  // govCsrGhgMismatchRule 例外，還會吐 DATA_NOT_YET_FILED）。
  // 引擎需要這份清單才能在「這次沒吐出任何該 code 的 flag」時，仍正確關閉舊異常。
  allCodes: string[];
  run(ctx: RuleContext): Promise<Flag[]>;
}
