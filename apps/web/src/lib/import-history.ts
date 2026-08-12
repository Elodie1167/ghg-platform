import { query } from '@/lib/db';

/**
 * 匯入覆蓋/整月取代前的快照（設計文件任務5，§10 的安全網）。
 * 只在寫入前呼叫，快照與真正的覆蓋動作不在同一交易也可接受——
 * 快照晚了頂多多一份、快照沒發生才是問題，因此故意先快照再覆蓋。
 */

export async function snapshotRecordBeforeOverwrite(
  recordId: string,
  reason: string,
): Promise<void> {
  await query(
    `INSERT INTO activity_records_history (activity_record_id, change_reason, id, factory_id,
        emission_source_id, year, month, activity_value, activity_unit, notes,
        co2e_location, co2e_market, co2e_total, co2e_biomass_co2, emission_factor_id,
        is_reviewed, reviewed_by, reviewed_at, import_source, created_by, created_at, updated_at,
        sub_location, meter_number, date_from, date_to, co2_t, ch4_t, n2o_t, hfc_t,
        source_doc_url, is_manual_co2e, is_round_trip)
     SELECT $1, $2, id, factory_id,
        emission_source_id, year, month, activity_value, activity_unit, notes,
        co2e_location, co2e_market, co2e_total, co2e_biomass_co2, emission_factor_id,
        is_reviewed, reviewed_by, reviewed_at, import_source, created_by, created_at, updated_at,
        sub_location, meter_number, date_from, date_to, co2_t, ch4_t, n2o_t, hfc_t,
        source_doc_url, is_manual_co2e, is_round_trip
       FROM activity_records WHERE id = $1`,
    [recordId, reason],
  );
}

export async function snapshotLineItemsBeforeDelete(
  recordId: string,
  reason: string,
): Promise<void> {
  await query(
    `INSERT INTO activity_line_items_history (change_reason, id, activity_record_id,
        invoice_no, invoice_date, quantity, unit, erp_ref, note, created_at)
     SELECT $2, id, activity_record_id,
        invoice_no, invoice_date, quantity, unit, erp_ref, note, created_at
       FROM activity_line_items WHERE activity_record_id = $1`,
    [recordId, reason],
  );
}
