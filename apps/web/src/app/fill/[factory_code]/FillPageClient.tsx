'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Factory, FactoryListItem, EmissionSource, ActivityRecord, WasteConfig, WasteMethodConfig } from './page';
import { MONTHS } from './tabTypes';
import ImportModal from './ImportModal';
import FuelTab from './FuelTab';
import CombustionTab from './CombustionTab';
import FugitiveTab from './FugitiveTab';
import UpstreamTab from './UpstreamTab';
import DownstreamTab from './DownstreamTab';
import PurchaseTab from './PurchaseTab';
import TravelTab from './TravelTab';
import CommuteTab from './CommuteTab';

const SOURCE_GROUPS = [
  { tabId: 'elec',        label: '電力來源',                 prefix: '2-'  },
  { tabId: 'combustion',  label: '固定燃燒 (鍋爐/發電機等)', prefix: '1-1' },
  { tabId: 'fuel',        label: '移動燃燒 (公務車/堆高機)',  prefix: '1-2' },
  { tabId: 'process',     label: '製程排放 S1',              prefix: '1-3' },
  { tabId: 'fugitive',    label: '逸散排放 (冷媒/滅火器)',    prefix: '1-4' },
  { tabId: 'purchase',    label: '採購商品與服務 3.1',         prefix: '3-1' },
  { tabId: 'energy',      label: '燃料及能源相關 3.3',         prefix: '3-3' },
  { tabId: 'waste',       label: '廢棄物處理 3.5',             prefix: '3-5' },
  { tabId: 'upstream',    label: '上游運輸 3.4',               prefix: '3-4' },
  { tabId: 'downstream',  label: '下游運輸 3.9',               prefix: '3-9' },
  { tabId: 'travel',      label: '商務旅行 3.6',               prefix: '3-6' },
  { tabId: 'commute',     label: '員工通勤 3.7',               prefix: '3-7' },
] as const;

type SourceGroupTabId = typeof SOURCE_GROUPS[number]['tabId'];

const TABS = [
  { id: 'basic',       label: '基本資訊' },
  { id: 'elec',        label: '電力 S2' },
  { id: 'fuel',        label: '移動 S1' },
  { id: 'combustion',  label: '固定 S1' },
  { id: 'fugitive',    label: '逸散 S1' },
  { id: 'process',     label: '製程 S1' },
  { id: 'purchase',    label: '採購商品 3.1' },
  { id: 'energy',      label: '能源相關 3.3' },
  { id: 'waste',       label: '廢棄物 3.5' },
  { id: 'upstream',    label: '上游運輸 3.4' },
  { id: 'downstream',  label: '下游運輸 3.9' },
  { id: 'travel',      label: '商務旅行 3.6' },
  { id: 'commute',     label: '員工通勤 3.7' },
  { id: 'summary',     label: '碳排彙總' },
] as const;

type TabId = typeof TABS[number]['id'];

const ELEC_SOURCE_CODE = '2-1-A';

const CUSTOM_SOURCE_ORDER: Record<string, number> = {
  // 固定燃燒：鍋爐類 → 廚房 → 發電機 → 其他
  '1-1A-1': 1, '1-1A-9': 2, '1-1B-1': 3, '1-1B-2': 4, '1-1A-3': 5,
  '1-1A-5': 6, '1-1A-6': 7, '1-1A-7': 8, '1-1A-8': 9,
  // 移動燃燒：公務車集中 → 堆高機
  '1-2A-1': 1, '1-2A-2': 2, '1-2A-6': 3, '1-2A-4': 4, '1-2A-5': 5,
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface ElecRow {
  tempKey: string;
  id: string | null;
  month: number;
  sub_location: string;
  activity_value: string;
  date_from: string;
  date_to: string;
  meter_number: string;
  co2e_total: number | null;
  is_reviewed: boolean;
  saveStatus: SaveStatus;
}

interface Props {
  factory: Factory;
  allFactories: FactoryListItem[];
  emissionSources: EmissionSource[];
  existingRecords: ActivityRecord[];
  year: number;
  initialSelectedIds: string[];
  initialWasteConfig: Partial<WasteConfig> | null;
}

function buildRecordMap(records: ActivityRecord[]): Map<string, ActivityRecord> {
  const map = new Map<string, ActivityRecord>();
  for (const r of records) {
    map.set(`${r.emission_source_id}-${r.month}`, r);
  }
  return map;
}

export default function FillPageClient({
  factory,
  allFactories,
  emissionSources,
  existingRecords,
  year,
  initialSelectedIds,
  initialWasteConfig,
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>('basic');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [importModalOpen, setImportModalOpen] = useState(false);

  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(
    () => new Set(initialSelectedIds),
  );

  const [wasteConfig, setWasteConfig] = useState<WasteConfig>(() => ({
    general: {
      enabled: initialWasteConfig?.general?.enabled ?? false,
      incineration: initialWasteConfig?.general?.incineration ?? 0,
      recycling: initialWasteConfig?.general?.recycling ?? 0,
      landfill: initialWasteConfig?.general?.landfill ?? 0,
    },
    textile: {
      enabled: initialWasteConfig?.textile?.enabled ?? false,
      incineration: initialWasteConfig?.textile?.incineration ?? 0,
      recycling: initialWasteConfig?.textile?.recycling ?? 0,
      landfill: initialWasteConfig?.textile?.landfill ?? 0,
    },
  }));

  const [localValues, setLocalValues] = useState<
    Record<string, { activity_value: string; notes: string }>
  >(() => {
    const init: Record<string, { activity_value: string; notes: string }> = {};
    for (const r of existingRecords) {
      init[`${r.emission_source_id}-${r.month}`] = {
        activity_value: r.activity_value != null ? String(r.activity_value) : '',
        notes: r.notes ?? '',
      };
    }
    return init;
  });

  const recordMap = useRef(buildRecordMap(existingRecords));

  const [upstreamTons, setUpstreamTons] = useState<Record<string, number>>(() => {
    const items = ['布料', '線料', '紙箱', '塑料袋'];
    const totals: Record<string, number> = {};
    for (const item of items) {
      totals[item] = existingRecords
        .filter((r) => {
          if (!r.source_code?.startsWith('3-4')) return false;
          const sl = r.sub_location ?? '';
          return sl === item || sl === `TW-${item}` || sl === `FC-${item}`;
        })
        .reduce((s, r) => s + (r.meter_number != null ? Number(r.meter_number) : 0), 0);
    }
    return totals;
  });
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localValuesRef = useRef(localValues);
  const elecSource = emissionSources.find((s) => s.source_code === ELEC_SOURCE_CODE);

  const autosave = useCallback(
    async (emission_source_id: string, month: number, value: string, notes: string) => {
      const numVal = parseFloat(value);
      if (value !== '' && isNaN(numVal)) return;
      setSaveStatus('saving');
      try {
        const res = await fetch('/api/records/autosave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            factory_id: factory.id,
            emission_source_id,
            year,
            month,
            activity_value: value === '' ? null : numVal,
            activity_unit: emissionSources.find((s) => s.id === emission_source_id)?.default_unit ?? 'kWh',
            notes: notes || null,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setSaveStatus('saved');
      } catch (err) {
        console.error('[autosave]', err);
        setSaveStatus('error');
      }
    },
    [factory.id, year, emissionSources],
  );

  const handleChange = useCallback(
    (emission_source_id: string, month: number, field: 'activity_value' | 'notes', val: string) => {
      const key = `${emission_source_id}-${month}`;
      setLocalValues((prev) => {
        const next = { ...prev, [key]: { ...prev[key], [field]: val } };
        localValuesRef.current = next;
        return next;
      });
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        const current = localValuesRef.current[key] ?? { activity_value: '', notes: '' };
        autosave(emission_source_id, month, current.activity_value, current.notes);
      }, 1000);
    },
    [autosave],
  );

  useEffect(() => {
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, []);

  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const saveLabels: Record<SaveStatus, string> = {
    idle: '', saving: '⏳ 儲存中…', saved: '✅ 已儲存', error: '❌ 儲存失敗',
  };
  const saveColors: Record<SaveStatus, string> = {
    idle: '', saving: 'text-yellow-400', saved: 'text-green-300', error: 'text-red-400',
  };

  function tabHasSelection(tabId: SourceGroupTabId): boolean {
    const grp = SOURCE_GROUPS.find((g) => g.tabId === tabId);
    if (!grp) return false;
    const groupSrcs = emissionSources.filter((s) => s.source_code.startsWith(grp.prefix));
    if (groupSrcs.some((s) => s.is_always_active)) return true;
    if (selectedSourceIds.size === 0) return false;
    return groupSrcs.some((s) => selectedSourceIds.has(s.id));
  }

  // ─── BasicTab ──────────────────────────────────────────────────
  function BasicTab() {
    const [pendingIds, setPendingIds] = useState<Set<string>>(new Set(selectedSourceIds));
    const [pendingWaste, setPendingWaste] = useState<WasteConfig>(wasteConfig);
    const [configSaving, setConfigSaving] = useState(false);
    const [configMsg, setConfigMsg] = useState('');
    const reviewedCount = existingRecords.filter((r) => r.is_reviewed).length;
    const unreviewedCount = existingRecords.filter((r) => !r.is_reviewed).length;

    const w1Source = emissionSources.find((s) => s.source_code === '3-5-W1');
    const w2Source = emissionSources.find((s) => s.source_code === '3-5-W2');

    async function handleSaveConfig() {
      setConfigSaving(true);
      setConfigMsg('');
      const finalIds = new Set(pendingIds);
      if (w1Source) { if (pendingWaste.general.enabled) finalIds.add(w1Source.id); else finalIds.delete(w1Source.id); }
      if (w2Source) { if (pendingWaste.textile.enabled) finalIds.add(w2Source.id); else finalIds.delete(w2Source.id); }
      try {
        const res = await fetch(`/api/factories/${factory.factory_code}/source-config`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selected_ids: Array.from(finalIds), waste_config: pendingWaste }),
        });
        if (!res.ok) throw new Error('Failed');
        setSelectedSourceIds(new Set(finalIds));
        setWasteConfig(pendingWaste);
        setConfigMsg('✅ 設定已儲存');
        setTimeout(() => setConfigMsg(''), 3000);
      } catch {
        setConfigMsg('❌ 儲存失敗，請重試');
      } finally {
        setConfigSaving(false);
      }
    }

    function WasteTypeRow({
      label,
      cfg,
      onChange,
    }: {
      label: string;
      cfg: WasteMethodConfig;
      onChange: (next: WasteMethodConfig) => void;
    }) {
      const sum = cfg.incineration + cfg.recycling + cfg.landfill;
      const valid = !cfg.enabled || sum === 100;
      return (
        <div className="border border-gray-200 rounded-lg p-4 mb-3">
          <div className="flex items-center gap-3 mb-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={cfg.enabled}
                onChange={(e) => onChange({ ...cfg, enabled: e.target.checked })}
                className="w-4 h-4" style={{ accentColor: '#16a34a' }}
              />
              <span className="text-sm font-medium text-gray-700">{label}</span>
            </label>
            {cfg.enabled && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${valid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {sum}% / 100%
              </span>
            )}
          </div>
          {cfg.enabled && (
            <div className="grid grid-cols-3 gap-3 mt-2">
              {([['incineration', '焚化'], ['recycling', '回收'], ['landfill', '掩埋']] as [keyof WasteMethodConfig, string][]).map(([k, lbl]) => (
                <div key={k} className="flex items-center gap-1">
                  <span className="text-xs text-gray-600 w-8 flex-shrink-0">{lbl}</span>
                  <input type="number" min={0} max={100} step={1}
                    value={cfg[k] as number}
                    onChange={(e) => onChange({ ...cfg, [k]: parseInt(e.target.value) || 0 })}
                    className={`w-full border rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${valid ? 'border-gray-300' : 'border-red-300'}`}
                  />
                  <span className="text-xs text-gray-400 flex-shrink-0">%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="max-w-5xl">
        <div className="flex items-start justify-between mb-6 pb-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">設定排放源</h2>
            <p className="text-sm text-gray-500 mt-0.5">勾選這個工廠實際擁有的設備與使用的資源類別</p>
          </div>
          <div className="text-right text-sm flex-shrink-0 ml-4">
            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium mr-2"
              style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>填報進行中</span>
            <span className="text-green-600 font-medium">已審查 {reviewedCount} 筆</span>
            <span className="mx-2 text-gray-300">|</span>
            <span className="text-gray-500">未審查 {unreviewedCount} 筆</span>
          </div>
        </div>

        {selectedSourceIds.size === 0 && (
          <div className="rounded-lg p-4 mb-6 text-sm flex items-start gap-3"
            style={{ backgroundColor: '#fffbeb', border: '1px solid #fcd34d' }}>
            <span className="text-xl flex-shrink-0">⚠️</span>
            <div style={{ color: '#92400e' }}>
              <strong>尚未設定排放源。</strong>
              請勾選這個工廠實際擁有的設備與使用的資源類別，儲存後對應分頁才會開啟。
            </div>
          </div>
        )}

        {SOURCE_GROUPS.map((group) => {
          if (group.tabId === 'waste') {
            const w1En = pendingWaste.general.enabled;
            const w2En = pendingWaste.textile.enabled;
            return (
              <div key={group.tabId} className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold text-gray-700 text-sm">{group.label}</h3>
                  {(w1En || w2En) && (
                    <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: '#d1fae5', color: '#065f46' }}>
                      已設定 {(w1En ? 1 : 0) + (w2En ? 1 : 0)} 種
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mb-3">
                  勾選廢棄物類型並設定各處置方式的百分比（合計須為 100%）。後續填報頁面只需輸入月度重量，系統依此計算碳排。
                </p>
                <WasteTypeRow
                  label="一般廢棄物"
                  cfg={pendingWaste.general}
                  onChange={(c) => setPendingWaste((p) => ({ ...p, general: c }))}
                />
                <WasteTypeRow
                  label="廢布／紡織廢棄物"
                  cfg={pendingWaste.textile}
                  onChange={(c) => setPendingWaste((p) => ({ ...p, textile: c }))}
                />
              </div>
            );
          }

          const groupSources = emissionSources.filter(
            (s) => s.source_code.startsWith(group.prefix) &&
                   s.source_code !== '3-5-W1' && s.source_code !== '3-5-W2',
          );
          if (groupSources.length === 0) return null;

          // 製程（焊條）：所有 1-3 來源合併成一個「焊條」checkbox
          if (group.tabId === 'process') {
            const weldSources = groupSources.filter((s) => !s.is_always_active);
            if (weldSources.length === 0) return null;
            const allChecked = weldSources.every((s) => pendingIds.has(s.id));
            const anyChecked = weldSources.some((s) => pendingIds.has(s.id));
            return (
              <div key={group.tabId} className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold text-gray-700 text-sm">{group.label}</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: anyChecked ? '#d1fae5' : '#f3f4f6', color: anyChecked ? '#065f46' : '#6b7280' }}>
                    {anyChecked ? '已選' : '未選'}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  <label
                    className="flex items-start gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all select-none"
                    style={{ backgroundColor: allChecked ? '#f0fdf4' : '#fff', borderColor: allChecked ? '#86efac' : '#e5e7eb', color: allChecked ? '#14532d' : '#374151' }}>
                    <input type="checkbox" checked={allChecked}
                      onChange={(e) => {
                        setPendingIds((prev) => {
                          const next = new Set(prev);
                          weldSources.forEach((s) => e.target.checked ? next.add(s.id) : next.delete(s.id));
                          return next;
                        });
                      }}
                      className="mt-0.5 w-4 h-4 flex-shrink-0" style={{ accentColor: '#16a34a' }}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-medium leading-snug">焊條</div>
                      <div className="text-xs opacity-50 font-mono">1-3</div>
                    </div>
                  </label>
                </div>
              </div>
            );
          }

          // 若整個群組都是自動啟用，只顯示 badge
          if (groupSources.every((s) => s.is_always_active)) {
            return (
              <div key={group.tabId} className="mb-4 flex items-center gap-2">
                <h3 className="font-semibold text-gray-400 text-sm">{group.label}</h3>
                <span className="text-xs px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: '#dbeafe', color: '#1e40af' }}>
                  所有廠別自動啟用
                </span>
              </div>
            );
          }

          // 過濾掉自動啟用，套用自訂排序
          const checkableSources = groupSources
            .filter((s) => !s.is_always_active)
            .sort((a, b) =>
              (CUSTOM_SOURCE_ORDER[a.source_code] ?? 999) - (CUSTOM_SOURCE_ORDER[b.source_code] ?? 999),
            );
          const selectedInGroup = checkableSources.filter((s) => pendingIds.has(s.id)).length;
          return (
            <div key={group.tabId} className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-semibold text-gray-700 text-sm">{group.label}</h3>
                <span className="text-xs px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: selectedInGroup > 0 ? '#d1fae5' : '#f3f4f6',
                    color: selectedInGroup > 0 ? '#065f46' : '#6b7280',
                  }}>
                  已選 {selectedInGroup}/{checkableSources.length}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {checkableSources.map((source) => {
                  const checked = pendingIds.has(source.id);
                  return (
                    <label key={source.id}
                      className="flex items-start gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all select-none"
                      style={{
                        backgroundColor: checked ? '#f0fdf4' : '#fff',
                        borderColor: checked ? '#86efac' : '#e5e7eb',
                        color: checked ? '#14532d' : '#374151',
                      }}>
                      <input type="checkbox" checked={checked}
                        onChange={(e) => {
                          setPendingIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(source.id); else next.delete(source.id);
                            return next;
                          });
                        }}
                        className="mt-0.5 w-4 h-4 flex-shrink-0"
                        style={{ accentColor: '#16a34a' }}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-medium leading-snug">{source.name_zh}</div>
                        <div className="text-xs opacity-50 font-mono">{source.source_code}</div>
                        {source.is_biomass && <span className="text-xs text-green-600">🌿 生質</span>}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="flex items-center gap-4 pt-5 mt-2 border-t border-gray-200 sticky bottom-0 bg-white py-4"
          style={{ zIndex: 5 }}>
          <button onClick={handleSaveConfig} disabled={configSaving}
            className="px-6 py-2 rounded-lg text-white font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: '#0C3D2E' }}>
            {configSaving ? '儲存中...' : '儲存排放源設定'}
          </button>
          {configMsg && <span className="text-sm text-gray-600">{configMsg}</span>}
          <span className="text-sm text-gray-400 ml-auto">已選 {pendingIds.size} 個排放源</span>
        </div>
      </div>
    );
  }

  // ─── ElecTab（多帳單版） ─────────────────────────────────────
  function ElecTab() {
    if (!elecSource) {
      return <p className="text-gray-500 py-8 text-center">找不到電力排放源（代碼 2-1-A）</p>;
    }

    const [rows, setRows] = useState<ElecRow[]>(() =>
      existingRecords
        .filter((r) => r.emission_source_id === elecSource!.id)
        .map((r) => ({
          tempKey: r.id,
          id: r.id,
          month: r.month,
          sub_location: r.sub_location ?? '',
          activity_value: r.activity_value != null ? String(r.activity_value) : '',
          date_from: r.date_from ?? '',
          date_to: r.date_to ?? '',
          meter_number: r.meter_number ?? '',
          co2e_total: r.co2e_total,
          is_reviewed: r.is_reviewed,
          saveStatus: 'idle' as SaveStatus,
        }))
    );

    const rowsRef = useRef(rows);
    useEffect(() => { rowsRef.current = rows; }, [rows]);
    const rowTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    function addRow() {
      const tempKey = `new-${Date.now()}`;
      setRows((prev) => [...prev, {
        tempKey, id: null,
        month: new Date().getMonth() + 1,
        sub_location: '', activity_value: '',
        date_from: '', date_to: '', meter_number: '',
        co2e_total: null, is_reviewed: false, saveStatus: 'idle',
      }]);
    }

    function updateRow(tempKey: string, field: keyof ElecRow, value: string | number) {
      setRows((prev) => prev.map((r) => r.tempKey === tempKey ? { ...r, [field]: value } : r));
      if (rowTimers.current[tempKey]) clearTimeout(rowTimers.current[tempKey]);
      rowTimers.current[tempKey] = setTimeout(() => saveRow(tempKey), 1000);
    }

    async function saveRow(tempKey: string) {
      const row = rowsRef.current.find((r) => r.tempKey === tempKey);
      if (!row) return;
      setRows((prev) => prev.map((r) => r.tempKey === tempKey ? { ...r, saveStatus: 'saving' } : r));
      const numVal = row.activity_value !== '' ? parseFloat(row.activity_value) : null;
      const payload = {
        factory_id: factory.id,
        emission_source_id: elecSource!.id,
        year,
        month: row.month,
        activity_value: (numVal != null && !isNaN(numVal)) ? numVal : null,
        activity_unit: 'kWh',
        sub_location: row.sub_location || null,
        meter_number: row.meter_number || null,
        date_from: row.date_from || null,
        date_to: row.date_to || null,
      };
      try {
        if (row.id) {
          const res = await fetch(`/api/records/${row.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } else {
          const res = await fetch('/api/records', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          setRows((prev) => prev.map((r) => r.tempKey === tempKey ? { ...r, id: data.data.id } : r));
        }
        setRows((prev) => prev.map((r) => r.tempKey === tempKey ? { ...r, saveStatus: 'saved' } : r));
        setTimeout(() => {
          setRows((prev) => prev.map((r) =>
            r.tempKey === tempKey && r.saveStatus === 'saved' ? { ...r, saveStatus: 'idle' } : r
          ));
        }, 2000);
      } catch {
        setRows((prev) => prev.map((r) => r.tempKey === tempKey ? { ...r, saveStatus: 'error' } : r));
      }
    }

    async function deleteRow(tempKey: string) {
      const row = rowsRef.current.find((r) => r.tempKey === tempKey);
      if (!row) return;
      if (row.id) {
        const res = await fetch(`/api/records/${row.id}`, { method: 'DELETE' });
        if (!res.ok) return;
      }
      setRows((prev) => prev.filter((r) => r.tempKey !== tempKey));
    }

    const totalKwh = rows.reduce((s, r) => s + (parseFloat(r.activity_value) || 0), 0);
    const totalCo2e = rows.reduce((s, r) => s + (r.co2e_total ?? 0), 0);

    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">範疇 2 — 電力消耗</h2>
            <p className="text-sm text-gray-500 mt-0.5">每月可有多張帳單（3 個計費區間 × 多電表）</p>
          </div>
          <button onClick={addRow}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium transition hover:opacity-90"
            style={{ backgroundColor: '#0C3D2E' }}>
            + 新增帳單
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-base mb-4">尚無電力帳單資料</p>
            <button onClick={addRow}
              className="px-6 py-2 rounded-lg text-white text-sm"
              style={{ backgroundColor: '#0C3D2E' }}>
              + 新增第一筆帳單
            </button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr style={{ backgroundColor: '#0C3D2E' }} className="text-white">
                    <th className="px-3 py-3 text-left w-24">月份</th>
                    <th className="px-3 py-3 text-left">場別 / 說明</th>
                    <th className="px-3 py-3 text-right w-32">用電量 (kWh)</th>
                    <th className="px-3 py-3 text-left w-32">帳單起日</th>
                    <th className="px-3 py-3 text-left w-32">帳單迄日</th>
                    <th className="px-3 py-3 text-left w-32">電表號碼</th>
                    <th className="px-3 py-3 text-right w-24">CO₂e (t)</th>
                    <th className="px-3 py-3 text-center w-12">狀態</th>
                    <th className="px-3 py-3 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={row.tempKey} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-2 py-1.5">
                        <select value={row.month}
                          onChange={(e) => updateRow(row.tempKey, 'month', parseInt(e.target.value))}
                          className="w-full border border-gray-300 rounded px-1 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                          {months.map((m) => (
                            <option key={m} value={m}>{m} 月</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="text" placeholder="廠房 A / 電表 B 區"
                          value={row.sub_location}
                          onChange={(e) => updateRow(row.tempKey, 'sub_location', e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="0.01" placeholder="kWh"
                          value={row.activity_value}
                          onChange={(e) => updateRow(row.tempKey, 'activity_value', e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="date"
                          value={row.date_from}
                          onChange={(e) => updateRow(row.tempKey, 'date_from', e.target.value)}
                          className="w-full border border-gray-300 rounded px-1 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="date"
                          value={row.date_to}
                          onChange={(e) => updateRow(row.tempKey, 'date_to', e.target.value)}
                          className="w-full border border-gray-300 rounded px-1 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="text" placeholder="電表號碼"
                          value={row.meter_number}
                          onChange={(e) => updateRow(row.tempKey, 'meter_number', e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right text-gray-400 text-xs font-mono">
                        {row.co2e_total != null ? row.co2e_total.toFixed(4) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-center text-sm">
                        {row.saveStatus === 'saving' && '⏳'}
                        {row.saveStatus === 'saved' && '✅'}
                        {row.saveStatus === 'error' && '❌'}
                        {row.saveStatus === 'idle' && row.id && (
                          <span className="text-gray-200">●</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button onClick={() => deleteRow(row.tempKey)}
                          className="text-gray-300 hover:text-red-500 transition text-lg leading-none"
                          title="刪除此帳單">
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ backgroundColor: '#f0fdf4' }} className="font-semibold">
                    <td colSpan={2} className="px-3 py-2 text-gray-700">合計</td>
                    <td className="px-3 py-2 text-right text-gray-700 font-mono">
                      {totalKwh.toLocaleString()} kWh
                    </td>
                    <td colSpan={3} />
                    <td className="px-3 py-2 text-right text-gray-700 font-mono">
                      {totalCo2e > 0 ? totalCo2e.toFixed(4) + ' t' : '—'}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              輸入停止 1 秒後自動儲存。CO₂e 計算引擎建置中，目前顯示 —。
            </p>
          </>
        )}
      </div>
    );
  }

  // ─── ProcessTab（製程排放：焊條）────────────────────────────
  function ProcessTab() {
    const processSources = emissionSources.filter(
      (s) => s.source_code.startsWith('1-3') && selectedSourceIds.has(s.id),
    );

    if (processSources.length === 0) {
      return (
        <div className="flex flex-col items-center py-20 text-gray-400">
          <p className="text-base mb-2">尚未設定製程排放源</p>
          <p className="text-sm">
            請至
            <button onClick={() => setActiveTab('basic')} className="text-green-600 underline mx-1">
              基本資訊
            </button>
            勾選焊條。
          </p>
        </div>
      );
    }

    function ProcessSection({ source }: { source: EmissionSource }) {
      interface ProcRow {
        id: string | null;
        value: string;
        carbonContent: string;
        notes: string;
        co2e: number | null;
        is_reviewed: boolean;
        saveStatus: SaveStatus;
      }

      const [rows, setRows] = useState<Record<number, ProcRow>>(() => {
        const init: Record<number, ProcRow> = {};
        for (const m of MONTHS) {
          const r = existingRecords.find(
            (rec) => rec.emission_source_id === source.id && rec.month === m,
          );
          init[m] = {
            id: r?.id ?? null,
            value: r?.activity_value != null ? String(r.activity_value) : '',
            carbonContent: r?.meter_number != null ? String(r.meter_number) : '',
            notes: r?.notes ?? '',
            co2e: r?.co2e_total ?? null,
            is_reviewed: r?.is_reviewed ?? false,
            saveStatus: 'idle',
          };
        }
        return init;
      });
      const rowsRef = useRef(rows);
      useEffect(() => { rowsRef.current = rows; }, [rows]);
      const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

      function onChange(month: number, field: 'value' | 'carbonContent' | 'notes', val: string) {
        const next = { ...rowsRef.current[month], [field]: val };
        rowsRef.current = { ...rowsRef.current, [month]: next };
        setRows((prev) => ({ ...prev, [month]: next }));
        if (timers.current[month]) clearTimeout(timers.current[month]);
        timers.current[month] = setTimeout(() => saveRow(month), 1000);
      }

      async function saveRow(month: number) {
        const row = rowsRef.current[month];
        if (!row) return;
        const numVal = row.value !== '' ? parseFloat(row.value) : null;
        if (row.value !== '' && (numVal === null || isNaN(numVal))) return;
        const saving = { ...row, saveStatus: 'saving' as SaveStatus };
        rowsRef.current = { ...rowsRef.current, [month]: saving };
        setRows((prev) => ({ ...prev, [month]: saving }));
        const payload = {
          factory_id: factory.id, emission_source_id: source.id,
          year, month,
          activity_value: numVal != null && !isNaN(numVal) ? numVal : null,
          activity_unit: source.default_unit,
          meter_number: row.carbonContent || null,
          notes: row.notes || null,
        };
        try {
          let id = row.id;
          if (id) {
            const res = await fetch(`/api/records/${id}`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error();
          } else {
            const res = await fetch('/api/records', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error();
            const data = await res.json();
            id = data.data.id;
          }
          const saved = { ...rowsRef.current[month], id, saveStatus: 'saved' as SaveStatus };
          rowsRef.current = { ...rowsRef.current, [month]: saved };
          setRows((prev) => ({ ...prev, [month]: saved }));
          setTimeout(() => {
            const idle = { ...rowsRef.current[month], saveStatus: 'idle' as SaveStatus };
            rowsRef.current = { ...rowsRef.current, [month]: idle };
            setRows((prev) => ({ ...prev, [month]: idle }));
          }, 2000);
        } catch {
          const err = { ...rowsRef.current[month], saveStatus: 'error' as SaveStatus };
          rowsRef.current = { ...rowsRef.current, [month]: err };
          setRows((prev) => ({ ...prev, [month]: err }));
        }
      }

      async function toggleReview(month: number) {
        const row = rowsRef.current[month];
        if (!row.id) return;
        const newVal = !row.is_reviewed;
        const next = { ...row, is_reviewed: newVal };
        rowsRef.current = { ...rowsRef.current, [month]: next };
        setRows((prev) => ({ ...prev, [month]: next }));
        await fetch(`/api/records/${row.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_reviewed: newVal }),
        });
      }

      const totalVol = Object.values(rows).reduce((s, r) => s + (parseFloat(r.value) || 0), 0);
      const totalCo2e = Object.values(rows).reduce((s, r) => s + (r.co2e ?? 0), 0);

      return (
        <div className="mb-8">
          <h3 className="font-semibold text-gray-800 mb-3">
            {source.name_zh}
            <span className="ml-2 text-xs font-mono text-gray-400">{source.source_code}</span>
          </h3>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ backgroundColor: '#0C3D2E' }} className="text-white">
                  <th className="px-3 py-2.5 text-left w-16">月份</th>
                  <th className="px-3 py-2.5 text-right w-36">採購量 ({source.default_unit})</th>
                  <th className="px-3 py-2.5 text-right w-28">含碳量 (%)</th>
                  <th className="px-3 py-2.5 text-right w-32">估計碳重 (kg)</th>
                  <th className="px-3 py-2.5 text-left">備註</th>
                  <th className="px-3 py-2.5 text-right w-24">CO₂e (t)</th>
                  <th className="px-3 py-2.5 text-center w-8">查核</th>
                  <th className="px-3 py-2.5 text-center w-8">狀</th>
                </tr>
              </thead>
              <tbody>
                {MONTHS.map((m) => {
                  const row = rows[m];
                  const kgVal = parseFloat(row.value) || 0;
                  const ccVal = parseFloat(row.carbonContent) || 0;
                  const estC = kgVal > 0 && ccVal > 0 ? kgVal * ccVal / 100 : null;
                  return (
                    <tr key={m} className={m % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                      <td className="px-3 py-1.5 font-medium text-gray-700">{m} 月</td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="0.01" placeholder="採購量"
                          value={row.value}
                          onChange={(e) => onChange(m, 'value', e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-green-500" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" max="100" step="0.001" placeholder="例：0.08"
                          value={row.carbonContent}
                          onChange={(e) => onChange(m, 'carbonContent', e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-green-500" />
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs text-gray-700">
                        {estC != null ? estC.toFixed(3) : '—'}
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="text" placeholder="供應商、規格等"
                          value={row.notes}
                          onChange={(e) => onChange(m, 'notes', e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-green-500" />
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs text-gray-400">
                        {row.co2e != null ? row.co2e.toFixed(4) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button onClick={() => toggleReview(m)} disabled={!row.id}
                          title={row.is_reviewed ? '已查核（點擊取消）' : '點擊標記查核完成'}
                          className={`text-base leading-none transition-all ${row.is_reviewed ? 'text-green-500' : 'text-gray-300'} ${!row.id ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:scale-110'}`}>
                          {row.is_reviewed ? '✅' : '⬜'}
                        </button>
                      </td>
                      <td className="px-2 py-1.5 text-center text-xs">
                        {row.saveStatus === 'saving' && '⏳'}
                        {row.saveStatus === 'saved' && '✓'}
                        {row.saveStatus === 'error' && '❌'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: '#f0fdf4' }} className="font-semibold text-sm">
                  <td className="px-3 py-2 text-gray-700">合計</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-700">
                    {totalVol.toLocaleString(undefined, { maximumFractionDigits: 2 })} {source.default_unit}
                  </td>
                  <td colSpan={3} />
                  <td className="px-3 py-2 text-right font-mono text-gray-700">
                    {totalCo2e > 0 ? totalCo2e.toFixed(4) + ' t' : '—'}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      );
    }

    return (
      <div>
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800">製程排放 S1 — 焊條</h2>
          <p className="text-sm text-gray-500 mt-0.5">每月填入採購量（kg）與含碳量（%），系統計算估計碳重，輸入停止 1 秒後自動儲存</p>
        </div>
        {processSources.map((src) => <ProcessSection key={src.id} source={src} />)}
      </div>
    );
  }

  // ─── WasteTab ────────────────────────────────────────────────
  function WasteTab() {
    const w1Source = emissionSources.find((s) => s.source_code === '3-5-W1');
    const w2Source = emissionSources.find((s) => s.source_code === '3-5-W2');

    if (!wasteConfig.general.enabled && !wasteConfig.textile.enabled) {
      return (
        <div className="flex flex-col items-center py-20 text-gray-400">
          <p className="text-base mb-2">尚未設定廢棄物處置方式</p>
          <p className="text-sm">
            請至
            <button onClick={() => setActiveTab('basic')} className="text-green-600 underline mx-1">
              基本資訊
            </button>
            設定廢棄物處置 % 後再填報。
          </p>
        </div>
      );
    }

    function formatMethods(cfg: WasteMethodConfig) {
      const parts: string[] = [];
      if (cfg.incineration > 0) parts.push(`焚化 ${cfg.incineration}%`);
      if (cfg.recycling > 0) parts.push(`回收 ${cfg.recycling}%`);
      if (cfg.landfill > 0) parts.push(`掩埋 ${cfg.landfill}%`);
      return parts.join(' | ') || '尚未設定';
    }

    function WasteSection({ source, cfg }: { source: EmissionSource; cfg: WasteMethodConfig }) {
      const [lv, setLv] = useState<Record<number, string>>(() => {
        const init: Record<number, string> = {};
        for (const r of existingRecords) {
          if (r.emission_source_id === source.id)
            init[r.month] = r.activity_value != null ? String(r.activity_value) : '';
        }
        return init;
      });
      const lvRef = useRef(lv);
      const [secStatus, setSecStatus] = useState<SaveStatus>('idle');
      const tmr = useRef<ReturnType<typeof setTimeout> | null>(null);

      function onWasteChange(month: number, val: string) {
        const next = { ...lvRef.current, [month]: val };
        lvRef.current = next;
        setLv(next);
        if (tmr.current) clearTimeout(tmr.current);
        tmr.current = setTimeout(async () => {
          const v = lvRef.current[month];
          const num = v === '' ? null : parseFloat(v);
          if (v !== '' && (num === null || isNaN(num!))) return;
          setSecStatus('saving');
          try {
            const res = await fetch('/api/records/autosave', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                factory_id: factory.id,
                emission_source_id: source.id,
                year, month,
                activity_value: num,
                activity_unit: 'kg',
                notes: null,
              }),
            });
            if (!res.ok) throw new Error();
            setSecStatus('saved');
            setTimeout(() => setSecStatus('idle'), 2000);
          } catch { setSecStatus('error'); }
        }, 1000);
      }

      const total = Object.values(lv).reduce((s, v) => s + (parseFloat(v) || 0), 0);
      const co2eTotal = existingRecords
        .filter((r) => r.emission_source_id === source.id && r.co2e_total != null)
        .reduce((s, r) => s + (r.co2e_total ?? 0), 0);

      return (
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-base font-semibold text-gray-800">{source.name_zh}</h3>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
              {formatMethods(cfg)}
            </span>
            {secStatus !== 'idle' && (
              <span className={`text-xs ${secStatus === 'saving' ? 'text-yellow-500' : secStatus === 'saved' ? 'text-green-500' : 'text-red-500'}`}>
                {secStatus === 'saving' ? '⏳ 儲存中' : secStatus === 'saved' ? '✅ 已儲存' : '❌ 失敗'}
              </span>
            )}
          </div>
          <table className="w-full border-collapse text-sm max-w-lg">
            <thead>
              <tr style={{ backgroundColor: '#0C3D2E' }} className="text-white">
                <th className="px-4 py-2 text-left w-16">月份</th>
                <th className="px-4 py-2 text-right">廢棄物重量 (kg)</th>
                <th className="px-4 py-2 text-right w-32">CO₂e (t)</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => {
                const existing = existingRecords.find(
                  (r) => r.emission_source_id === source.id && r.month === m,
                );
                const val = lv[m] ?? (existing?.activity_value != null ? String(existing.activity_value) : '');
                return (
                  <tr key={m} className={m % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                    <td className="px-4 py-1.5 font-medium text-gray-700">{m} 月</td>
                    <td className="px-4 py-1.5">
                      <input type="number" min="0" step="0.01" placeholder="輸入重量"
                        value={val}
                        onChange={(e) => onWasteChange(m, e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                    </td>
                    <td className="px-4 py-1.5 text-right text-gray-400 text-xs font-mono">
                      {existing?.co2e_total != null ? existing.co2e_total.toFixed(4) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-green-50 font-semibold">
                <td className="px-4 py-2 text-gray-700">合計</td>
                <td className="px-4 py-2 text-right text-gray-700 font-mono">{total.toLocaleString()} kg</td>
                <td className="px-4 py-2 text-right text-gray-700 font-mono">
                  {co2eTotal > 0 ? co2eTotal.toFixed(4) + ' t' : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      );
    }

    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">廢棄物 3.5 — 月度重量填報</h2>
            <p className="text-sm text-gray-500 mt-0.5">CO₂e 依基本資訊設定之處置%自動計算（計算引擎建置中）</p>
          </div>
        </div>
        {wasteConfig.general.enabled && w1Source && (
          <WasteSection source={w1Source} cfg={wasteConfig.general} />
        )}
        {wasteConfig.textile.enabled && w2Source && (
          <WasteSection source={w2Source} cfg={wasteConfig.textile} />
        )}
      </div>
    );
  }

  // ─── StubTab ─────────────────────────────────────────────────
  function StubTab({ label, tabId }: { label: string; tabId: SourceGroupTabId }) {
    const grp = SOURCE_GROUPS.find((g) => g.tabId === tabId);
    const isSelected = grp
      ? emissionSources.filter((s) => s.source_code.startsWith(grp.prefix)).some((s) => selectedSourceIds.has(s.id))
      : false;

    if (selectedSourceIds.size > 0 && !isSelected) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <svg className="w-12 h-12 mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
          <p className="text-base font-medium">此廠未設定「{label}」排放源</p>
          <p className="text-sm mt-1">
            如有需要，請至{' '}
            <button onClick={() => setActiveTab('basic')} className="text-green-600 underline hover:text-green-800">
              基本資訊
            </button>
            {' '}勾選對應排放源。
          </p>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <svg className="w-16 h-16 mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
        <p className="text-lg font-medium">「{label}」即將開放</p>
        <p className="text-sm mt-1">此分頁功能正在建置中，敬請期待。</p>
        <p className="text-sm mt-1 text-green-600">您可使用「批次匯入 Excel」功能一次匯入所有資料。</p>
      </div>
    );
  }

  // ─── SummaryTab ──────────────────────────────────────────────
  function SummaryTab() {
    const totalCo2e = existingRecords.filter((r) => r.co2e_total != null).reduce((s, r) => s + (r.co2e_total ?? 0), 0);
    const reviewedCo2e = existingRecords.filter((r) => r.co2e_total != null && r.is_reviewed).reduce((s, r) => s + (r.co2e_total ?? 0), 0);
    return (
      <div className="max-w-3xl">
        <h2 className="text-lg font-semibold text-gray-800 mb-6">碳排彙總 — {factory.name_zh} {year} 年</h2>
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-green-50 border border-green-200 rounded-xl p-5">
            <div className="text-sm text-green-700 mb-1">全年累計碳排（已計算）</div>
            <div className="text-3xl font-bold text-green-800">{totalCo2e.toFixed(3)}</div>
            <div className="text-xs text-green-600 mt-1">公噸 CO₂e</div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
            <div className="text-sm text-blue-700 mb-1">已審查碳排（納入統計）</div>
            <div className="text-3xl font-bold text-blue-800">{reviewedCo2e.toFixed(3)}</div>
            <div className="text-xs text-blue-600 mt-1">公噸 CO₂e</div>
          </div>
        </div>
        <p className="text-sm text-gray-400 text-center">詳細彙整報告建置中，敬請期待。</p>
      </div>
    );
  }

  // ─── TabContent ──────────────────────────────────────────────
  function TabContent() {
    switch (activeTab) {
      case 'basic':      return <BasicTab />;
      case 'elec':       return <ElecTab />;
      case 'waste':      return <WasteTab />;
      case 'fuel':       return <FuelTab factory={factory} year={year} emissionSources={emissionSources} selectedSourceIds={selectedSourceIds} existingRecords={existingRecords} setActiveTab={(t) => setActiveTab(t as TabId)} />;
      case 'combustion': return <CombustionTab factory={factory} year={year} emissionSources={emissionSources} selectedSourceIds={selectedSourceIds} existingRecords={existingRecords} setActiveTab={(t) => setActiveTab(t as TabId)} />;
      case 'fugitive':   return <FugitiveTab factory={factory} year={year} emissionSources={emissionSources} selectedSourceIds={selectedSourceIds} existingRecords={existingRecords} setActiveTab={(t) => setActiveTab(t as TabId)} />;
      case 'process':    return <ProcessTab />;
      case 'purchase':   return <PurchaseTab factory={factory} year={year} emissionSources={emissionSources} selectedSourceIds={selectedSourceIds} existingRecords={existingRecords} setActiveTab={(t) => setActiveTab(t as TabId)} upstreamTons={upstreamTons} />;
      case 'energy':     return <StubTab label="能源相關 3.3" tabId="energy" />;
      case 'upstream':   return null;  // always-mounted outside TabContent
      case 'downstream': return <DownstreamTab factory={factory} year={year} emissionSources={emissionSources} selectedSourceIds={selectedSourceIds} existingRecords={existingRecords} setActiveTab={(t) => setActiveTab(t as TabId)} />;
      case 'travel':     return <TravelTab factory={factory} year={year} emissionSources={emissionSources} selectedSourceIds={selectedSourceIds} existingRecords={existingRecords} setActiveTab={(t) => setActiveTab(t as TabId)} />;
      case 'commute':    return <CommuteTab factory={factory} year={year} emissionSources={emissionSources} selectedSourceIds={selectedSourceIds} existingRecords={existingRecords} setActiveTab={(t) => setActiveTab(t as TabId)} />;
      case 'summary':    return <SummaryTab />;
    }
  }

  return (
    <div className="min-h-screen bg-gray-50" style={{ fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ backgroundColor: '#0C3D2E' }} className="text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <a href="/" className="text-green-300 hover:text-white text-sm transition flex-shrink-0">
                ← 所有廠別
              </a>
              <div className="w-px h-5 bg-green-700 flex-shrink-0" />
              <div className="flex items-center gap-2">
                <span className="text-white font-semibold text-sm flex-shrink-0">工廠：</span>
                <select
                  value={factory.factory_code}
                  onChange={(e) => router.push(`/fill/${e.target.value}`)}
                  className="bg-green-800 text-white text-sm rounded px-2 py-1 border border-green-600 focus:outline-none focus:ring-2 focus:ring-green-400"
                  style={{ minWidth: '200px' }}
                >
                  {allFactories.map((f) => (
                    <option key={f.id} value={f.factory_code}>
                      {f.factory_code} — {f.name_zh}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-4 flex-shrink-0">
              <span className="text-green-300 text-sm hidden sm:inline">{year} 年</span>
              {saveStatus !== 'idle' && (
                <span className={`text-sm font-medium ${saveColors[saveStatus]}`}>
                  {saveLabels[saveStatus]}
                </span>
              )}
              <a href="/admin/factors"
                className="border border-green-500 text-green-200 hover:bg-green-800 hover:text-white font-medium text-sm px-3 py-1.5 rounded-lg transition">
                係數管理
              </a>
              <button onClick={() => setImportModalOpen(true)}
                className="bg-white text-green-900 hover:bg-green-50 font-medium text-sm px-4 py-1.5 rounded-lg shadow transition">
                批次匯入 Excel
              </button>
            </div>
          </div>
        </div>
      </header>

      <nav className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-0.5 overflow-x-auto py-1">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const sgTabId = tab.id as SourceGroupTabId;
              const hasGrp = SOURCE_GROUPS.some((g) => g.tabId === sgTabId);
              const isConfiguredTab = hasGrp && tabHasSelection(sgTabId);
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className="relative whitespace-nowrap px-3 py-2 text-sm font-medium rounded-md transition"
                  style={isActive ? { backgroundColor: '#0C3D2E', color: '#fff' } : { color: '#4b5563' }}>
                  {tab.label}
                  {!isActive && isConfiguredTab && (
                    <span className="absolute top-1.5 right-1 w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: '#16a34a' }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* UpstreamTab always mounted; CSS hides it when not active to preserve state */}
      <div style={{ display: activeTab === 'upstream' ? undefined : 'none' }}
        className="max-w-7xl mx-auto px-4 py-6">
        <UpstreamTab factory={factory} year={year} emissionSources={emissionSources}
          selectedSourceIds={selectedSourceIds} existingRecords={existingRecords}
          setActiveTab={(t) => setActiveTab(t as TabId)}
          onTonsChange={(tons) => setUpstreamTons(tons)} />
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6" style={{ display: activeTab === 'upstream' ? 'none' : undefined }}>
        <TabContent />
      </main>

      <footer className="text-center text-xs text-gray-400 py-6 border-t border-gray-200 mt-8">
        GHG 碳盤查系統 ｜ 資料僅供內部使用，請妥善保管填報連結
      </footer>

      {importModalOpen && (
        <ImportModal factory={factory} year={year} onClose={() => setImportModalOpen(false)} />
      )}
    </div>
  );
}
