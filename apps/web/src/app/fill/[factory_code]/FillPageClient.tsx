'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Factory, FactoryListItem, EmissionSource, ActivityRecord, WasteConfig, WasteMethodConfig, AssignedFactor, TravelModeConfig, TravelSourceMode } from './page';
import { MONTHS, HEADER_BG } from './tabTypes';
import ImportModal from './ImportModal';
import FuelTab from './FuelTab';
import CombustionTab from './CombustionTab';
import FugitiveTab from './FugitiveTab';
import UpstreamTab from './UpstreamTab';
import DownstreamTab from './DownstreamTab';
import PurchaseTab from './PurchaseTab';
import TravelTab from './TravelTab';
import CommuteTab from './CommuteTab';
import RECPanel from './RECPanel';
import LineItemsModal from './LineItemsModal';
import LineItemsCell from './LineItemsCell';

const SOURCE_GROUPS = [
  { tabId: 'elec',        label: '電力來源',                 prefix: '2-'  },
  { tabId: 'combustion',  label: '固定燃燒 (鍋爐/發電機等)', prefix: '1-1' },
  { tabId: 'fuel',        label: '移動燃燒 (公務車/堆高機)',  prefix: '1-2' },
  { tabId: 'process',     label: '製程排放 S1',              prefix: '1-3' },
  { tabId: 'fugitive',    label: '逸散排放 (冷媒/滅火器)',    prefix: '1-4' },
  // 以下依 GHG Protocol Scope 3 類別編號排序（Cat1/3/4/5/6/7/9），不要憑感覺調換
  { tabId: 'purchase',    label: '採購商品與服務 3.1',         prefix: '3-1' },
  { tabId: 'energy',      label: '燃料及能源相關 3.3',         prefix: '3-3' },
  { tabId: 'upstream',    label: '上游運輸 3.4',               prefix: '3-4' },
  { tabId: 'waste',       label: '廢棄物處理 3.5',             prefix: '3-5' },
  { tabId: 'travel',      label: '商務旅行 3.6',               prefix: '3-6' },
  { tabId: 'commute',     label: '員工通勤 3.7',               prefix: '3-7' },
  { tabId: 'downstream',  label: '下游運輸 3.9',               prefix: '3-9' },
] as const;

type SourceGroupTabId = typeof SOURCE_GROUPS[number]['tabId'];

// 碳排彙總分頁（SummaryTab）分類用：依 GHG Protocol 類別編號排序，不用資料庫
// emission_sources.category 欄位（新舊排放源分別存過中英文，不統一）
const CAT_ORDER: { prefix: string; label: string }[] = [
  { prefix: '1-1', label: '固定燃燒' },
  { prefix: '1-2', label: '移動燃燒' },
  { prefix: '1-3', label: '製程排放' },
  { prefix: '1-4', label: '逸散排放' },
  { prefix: '2-1', label: '外購電力' },
  { prefix: '3-1', label: '採購商品與服務' },
  { prefix: '3-3', label: '燃料及能源相關' },
  { prefix: '3-4', label: '上游運輸' },
  { prefix: '3-5', label: '廢棄物處理' },
  { prefix: '3-6', label: '商務旅行' },
  { prefix: '3-7', label: '員工通勤' },
  { prefix: '3-9', label: '下游運輸' },
];

const TABS = [
  { id: 'basic',       label: '基本資訊' },
  { id: 'elec',        label: '電力 S2' },
  { id: 'fuel',        label: '移動 S1' },
  { id: 'combustion',  label: '固定 S1' },
  { id: 'fugitive',    label: '逸散 S1' },
  { id: 'process',     label: '製程 S1' },
  { id: 'purchase',    label: '採購商品 3.1' },
  { id: 'energy',      label: '能源相關 3.3' },
  { id: 'upstream',    label: '上游運輸 3.4' },
  { id: 'waste',       label: '廢棄物 3.5' },
  { id: 'travel',      label: '商務旅行 3.6' },
  { id: 'commute',     label: '員工通勤 3.7' },
  { id: 'downstream',  label: '下游運輸 3.9' },
  { id: 'summary',     label: '碳排彙總' },
] as const;

type TabId = typeof TABS[number]['id'];

const ELEC_SOURCE_CODE = '2-1-A';
const SOLAR_SOURCE_CODE = '2-1-B';

// 商務旅行可切換「機票/車票碳排法」的排放源：3-6-A 飛機、3-6-C 高鐵（住宿 3-6-B 不適用）
const TRAVEL_MANUAL_CODES: Record<string, string> = { '3-6-A': '飛機', '3-6-C': '高鐵' };

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
  initialTravelConfig: TravelModeConfig;
  assignedFactors: AssignedFactor[];
  recMwh: number;
}

function buildRecordMap(records: ActivityRecord[]): Map<string, ActivityRecord> {
  const map = new Map<string, ActivityRecord>();
  for (const r of records) {
    map.set(`${r.emission_source_id}-${r.month}`, r);
  }
  return map;
}

// Available reporting years (expand as needed)
const REPORT_YEARS = [2023, 2024, 2025, 2026, 2027, 2028];

export default function FillPageClient({
  factory,
  allFactories,
  emissionSources,
  existingRecords: initialRecords,
  year,
  initialSelectedIds,
  initialWasteConfig,
  initialTravelConfig,
  assignedFactors,
  recMwh,
}: Props) {
  // Build a lookup: emission_source_id → assigned factor for quick access in tabs.
  // 共用係數的來源（如太陽能 2-1-B 的 factor_source_id 指到 2-1-A）本身沒有自己的
  // emission_factor_assignments，要 fallback 到它 factor_source_id 指向的那筆，
  // 否則「適用係數」面板找不到對應係數而整列不顯示。
  const factorByEmissionSourceId = Object.fromEntries(
    assignedFactors.map((f) => [f.emission_source_id, f]),
  ) as Record<string, AssignedFactor>;
  const factorBySourceId: Record<string, AssignedFactor> = {};
  for (const s of emissionSources) {
    const direct = factorByEmissionSourceId[s.id];
    const shared = s.factor_source_id ? factorByEmissionSourceId[s.factor_source_id] : undefined;
    const f = direct ?? shared;
    if (f) factorBySourceId[s.id] = f;
  }
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>('basic');

  // 記錄改用 state（初值為 SSR 快照）。切換分頁時從 DB 重新載入，
  // 因為 TabContent 是行內元件、父層重繪即會 remount，分頁便會以最新資料重新初始化。
  // 這樣本 session 新增/修改（已存進 DB）的列，切分頁往返後不會從畫面消失。
  const [existingRecords, setExistingRecords] = useState<ActivityRecord[]>(initialRecords);

  const refreshRecords = useCallback(async () => {
    try {
      const res = await fetch(`/api/records?factory_id=${factory.id}&year=${year}`);
      const { data } = await res.json();
      if (Array.isArray(data)) setExistingRecords(data as ActivityRecord[]);
    } catch { /* 靜默失敗，保留現有資料 */ }
  }, [factory.id, year]);

  // 每次切換分頁時從 DB 重新載入（含本 session 新增的列）
  useEffect(() => {
    refreshRecords();
  }, [activeTab, refreshRecords]);
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

  const [travelConfig, setTravelConfig] = useState<TravelModeConfig>(() => ({ ...initialTravelConfig }));

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
  // 查核狀態暫存用 ref（不用 state）：切換查核時「不」觸發父層重繪，
  // 否則行內分頁元件（ElecTab / RECPanel 等）會整個 remount，剛輸入的
  // 電力數值、iREC、勾選都會被清掉。各分頁勾選會由自身 local state 即時顯示；
  // enrichedRecords 於下次 render（例如切換分頁）時讀取 ref 反映最新查核狀態。
  const reviewedOverridesRef = useRef<Map<string, boolean>>(
    new Map(existingRecords.map((r) => [r.id, r.is_reviewed])),
  );

  function handleReviewToggle(id: string, newVal: boolean) {
    reviewedOverridesRef.current.set(id, newVal);
  }

  const enrichedRecords: ActivityRecord[] = existingRecords.map((r) => ({
    ...r,
    is_reviewed: reviewedOverridesRef.current.get(r.id) ?? r.is_reviewed,
  }));

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localValuesRef = useRef(localValues);
  const elecSource = emissionSources.find((s) => s.source_code === ELEC_SOURCE_CODE);
  const solarSource = emissionSources.find((s) => s.source_code === SOLAR_SOURCE_CODE);

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
    const [pendingTravel, setPendingTravel] = useState<TravelModeConfig>(travelConfig);
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
          body: JSON.stringify({ selected_ids: Array.from(finalIds), waste_config: pendingWaste, travel_mode: pendingTravel }),
        });
        if (!res.ok) throw new Error('Failed');
        setSelectedSourceIds(new Set(finalIds));
        setWasteConfig(pendingWaste);
        setTravelConfig(pendingTravel);
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

          // 商務旅行：勾選之外，飛機/高鐵各自可切換「距離法」或「機票/車票碳排法」
          if (group.tabId === 'travel') {
            const manualCount = Object.values(pendingTravel).filter((m) => m === 'manual').length;
            return (
              <div key={group.tabId} className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold text-gray-700 text-sm">{group.label}</h3>
                  {manualCount > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: '#d1fae5', color: '#065f46' }}>
                      {manualCount} 種用機票碳排法
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 mb-3">
                  {groupSources
                    .filter((s) => !s.is_always_active)
                    .map((source) => {
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
                          </div>
                        </label>
                      );
                    })}
                </div>
                <div className="border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-3">
                    飛機／高鐵可選擇填報方式：「距離法」填人次與距離、套排放係數自動算；
                    「機票/車票碳排法」直接填票證上標示的 CO₂e（kg），不套係數。
                    住宿（3-6-B）僅支援房晚計算，無此選項。
                  </p>
                  <div className="grid grid-cols-2 gap-4 max-w-md">
                    {Object.entries(TRAVEL_MANUAL_CODES).map(([code, label]) => {
                      const src = groupSources.find((s) => s.source_code === code);
                      if (!src) return null;
                      const mode: TravelSourceMode = pendingTravel[code] ?? 'distance';
                      return (
                        <label key={code} className="flex items-center gap-2 text-sm text-gray-700">
                          <span className="w-10 flex-shrink-0">{label}</span>
                          <select value={mode}
                            onChange={(e) => setPendingTravel((p) => ({ ...p, [code]: e.target.value as TravelSourceMode }))}
                            className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                            <option value="distance">距離法</option>
                            <option value="manual">機票/車票碳排法</option>
                          </select>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          }

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
  // 外購電力（2-1-A）與太陽能（2-1-B）欄位完全相同，共用同一張多帳單表格。
  // 太陽能係數於 DB 以 factor_source_id 共用 2-1-A：中國帶市場剩餘係數、
  // 台灣（及其他國別）帶電網排放係數；iREC 憑證只抵扣外購電力，不套用到太陽能。
  function BillTable({ source, isSolar, onTotalChange }: { source: EmissionSource; isSolar: boolean; onTotalChange?: (kwh: number) => void }) {
    const [rows, setRows] = useState<ElecRow[]>(() =>
      existingRecords
        .filter((r) => r.emission_source_id === source.id)
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
    const [liRecord, setLiRecord] = useState<{ id: string; title: string } | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    function toggleSelect(tempKey: string) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(tempKey)) next.delete(tempKey); else next.add(tempKey);
        return next;
      });
    }

    function toggleSelectAll() {
      setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.tempKey))));
    }

    function targetRows() {
      return selected.size > 0 ? rows.filter((r) => selected.has(r.tempKey)) : rows;
    }

    async function bulkReview() {
      const targets = targetRows().filter((r) => r.id && !r.is_reviewed);
      await Promise.all(targets.map((r) => toggleReview(r.tempKey)));
      setSelected(new Set());
    }

    async function bulkDelete() {
      const targets = targetRows().filter((r) => r.id && !r.is_reviewed);
      if (targets.length === 0) { setSelected(new Set()); return; }
      if (!confirm(`確定要刪除 ${targets.length} 筆尚未查核的資料？`)) return;
      await Promise.all(targets.map((r) => deleteRow(r.tempKey)));
      setSelected(new Set());
    }

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
        emission_source_id: source.id,
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

    async function toggleReview(tempKey: string) {
      const row = rowsRef.current.find((r) => r.tempKey === tempKey);
      if (!row?.id) return;
      const newVal = !row.is_reviewed;
      setRows((p) => p.map((r) => r.tempKey === tempKey ? { ...r, is_reviewed: newVal } : r));
      await fetch(`/api/records/${row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_reviewed: newVal }),
      });
      handleReviewToggle(row.id, newVal);
    }

    const totalKwh = rows.reduce((s, r) => s + (parseFloat(r.activity_value) || 0), 0);
    useEffect(() => { onTotalChange?.(totalKwh); }, [totalKwh]);
    // 係數單位 tCO₂e/MWh：CO₂e = kWh ÷ 1000 × 係數（即時計算，不等伺服器；不含 iREC 抵扣，
    // iREC 合併市電+太陽能扣抵後的市場別數字見下方「碳排放量計算」面板）。
    // 地域別一律用電網係數（市電／太陽能皆同）；此處單列預覽用地域別係數。
    const elecFactorRow = assignedFactors.find((f) => f.source_code === ELEC_SOURCE_CODE);
    const previewFactor = elecFactorRow?.grid_emission_factor ?? null;
    const rowCo2e = (kwh: number): number | null =>
      previewFactor != null && kwh > 0 ? parseFloat((kwh / 1000 * Number(previewFactor)).toFixed(4)) : null;
    const totalCo2e = rowCo2e(totalKwh) ?? 0;

    return (
      <div className={isSolar ? 'mt-10' : ''}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">
              {isSolar ? '範疇 2 — 太陽能' : '範疇 2 — 電力消耗'}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {isSolar
                ? `每月可有多筆紀錄（多案場 × 多電表）；${factory.country_code === 'CHN' ? '中國採市場剩餘係數' : '採電網排放係數'}`
                : '每月可有多張帳單（3 個計費區間 × 多電表）'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={bulkReview}
              disabled={rows.length === 0}
              className="px-3 py-2 rounded-lg border border-green-700 text-green-700 text-sm font-medium transition hover:bg-green-50 disabled:opacity-30 disabled:cursor-not-allowed">
              全選查核
            </button>
            <button onClick={bulkDelete}
              disabled={rows.length === 0}
              className="px-3 py-2 rounded-lg border border-red-400 text-red-500 text-sm font-medium transition hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed">
              全選刪除
            </button>
            <button onClick={addRow}
              className="px-4 py-2 rounded-lg text-white text-sm font-medium transition hover:opacity-90"
              style={{ backgroundColor: '#0C3D2E' }}>
              + 新增帳單
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-base mb-4">{isSolar ? '尚無太陽能發電資料' : '尚無電力帳單資料'}</p>
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
                    <th className="px-2 py-3 text-center w-8">
                      <input type="checkbox"
                        checked={rows.length > 0 && selected.size === rows.length}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th className="px-3 py-3 text-left w-24">月份</th>
                    <th className="px-3 py-3 text-left">場別 / 說明</th>
                    <th className="px-3 py-3 text-right w-32">用電量 (kWh)</th>
                    <th className="px-3 py-3 text-left w-32">帳單起日</th>
                    <th className="px-3 py-3 text-left w-32">帳單迄日</th>
                    <th className="px-3 py-3 text-left w-32">電表號碼</th>
                    <th className="px-3 py-3 text-right w-24">CO₂e (t)</th>
                    <th className="px-3 py-3 text-center w-28">當月加總明細</th>
                    <th className="px-3 py-3 text-center w-10">查核</th>
                    <th className="px-3 py-3 text-center w-12">狀態</th>
                    <th className="px-3 py-3 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={row.tempKey} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox"
                          checked={selected.has(row.tempKey)}
                          onChange={() => toggleSelect(row.tempKey)}
                        />
                      </td>
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
                        <input type="number" min="0" step="any" placeholder="kWh（可到小數 10 位）"
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
                      <td className="px-3 py-1.5 text-right text-gray-700 text-xs font-mono">
                        {(() => {
                          const c = rowCo2e(parseFloat(row.activity_value) || 0);
                          return c != null ? c.toFixed(4) : (row.co2e_total != null ? row.co2e_total.toFixed(4) : '—');
                        })()}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {row.id
                          ? <button type="button" onClick={() => setLiRecord({ id: row.id!, title: `${source.name_zh} ${row.month} 月` })}
                              className="text-blue-600 hover:text-blue-800 text-xs underline">查看</button>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button onClick={() => toggleReview(row.tempKey)}
                          disabled={!row.id}
                          className="text-xl leading-none disabled:opacity-30"
                          title={row.is_reviewed ? '取消查核' : '標記已查核'}>
                          {row.is_reviewed ? '✅' : '⬜'}
                        </button>
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
                        <button onClick={() => !row.is_reviewed && deleteRow(row.tempKey)}
                          disabled={row.is_reviewed}
                          className="text-gray-300 hover:text-red-500 transition text-lg leading-none disabled:opacity-30 disabled:cursor-not-allowed"
                          title={row.is_reviewed ? '已查核，不可刪除' : '刪除此帳單'}>
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ backgroundColor: '#f0fdf4' }} className="font-semibold">
                    <td colSpan={3} className="px-3 py-2 text-gray-700">合計</td>
                    <td className="px-3 py-2 text-right text-gray-700 font-mono">
                      {totalKwh.toLocaleString(undefined, { minimumFractionDigits: 10, maximumFractionDigits: 10 })} kWh
                    </td>
                    <td colSpan={3} />
                    <td className="px-3 py-2 text-right text-gray-700 font-mono">
                      {totalCo2e > 0 ? totalCo2e.toFixed(4) + ' t' : '—'}
                    </td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              輸入停止 1 秒後自動儲存。CO₂e（地域別預覽）= 用電量(kWh) ÷ 1000 × 電網排放係數(tCO₂e/MWh)。
              {isSolar && ' 太陽能不計入 3.3 T&D 輸配電損失；市場別（含 iREC 抵扣）見下方「碳排放量計算」。'}
            </p>
          </>
        )}
        {liRecord && (
          <LineItemsModal
            recordId={liRecord.id}
            title={liRecord.title}
            unit="kWh"
            refLabel="電表號碼"
            readOnly
            onClose={() => setLiRecord(null)}
          />
        )}
      </div>
    );
  }

  // ─── ElecTab：外購電力 ＋（有勾選時）太陽能 ─────────────────
  function ElecTab() {
    if (!elecSource) {
      return <p className="text-gray-500 py-8 text-center">找不到電力排放源（代碼 2-1-A）</p>;
    }
    const showSolar = !!solarSource && selectedSourceIds.has(solarSource.id);
    const [gridKwh, setGridKwh] = useState(0);
    const [solarKwh, setSolarKwh] = useState(0);
    const elecFactorRow = assignedFactors.find((f) => f.source_code === ELEC_SOURCE_CODE);
    const gridFactor = elecFactorRow?.grid_emission_factor ?? null;
    // 市場別係數：中國用剩餘係數、其他國別退回電網係數（市電＋太陽能共用同一筆係數列）
    const marketFactor = (factory.country_code === 'CHN'
      ? elecFactorRow?.market_residual_factor
      : elecFactorRow?.grid_emission_factor) ?? null;
    return (
      <div>
        <BillTable source={elecSource} isSolar={false} onTotalChange={setGridKwh} />
        {showSolar && <BillTable source={solarSource!} isSolar onTotalChange={setSolarKwh} />}
        {!showSolar && solarSource && (
          <p className="text-xs text-gray-400 mt-8 border-t border-gray-100 pt-4">
            如本廠有太陽能發電，請至
            <button onClick={() => setActiveTab('basic')} className="text-green-600 underline mx-1">
              基本資訊 → 電力來源
            </button>
            勾選「太陽能（2-1-B）」後回此頁填報。
          </p>
        )}
        {/* iREC 抵扣以「市電＋太陽能」合計電量計算：市場別 = max(0,合計電量−iREC)÷1000×市場係數 */}
        <RECPanel
          factoryId={factory.id}
          year={year}
          totalElecKwh={gridKwh + solarKwh}
          gridFactor={gridFactor}
          marketFactor={marketFactor}
        />
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

      // 清空某月（activity_value→null，後端一併清 co2e）
      async function clearMonth(month: number) {
        const row = rowsRef.current[month];
        const cleared = { ...row, value: '', carbonContent: '', notes: '', co2e: null };
        rowsRef.current = { ...rowsRef.current, [month]: cleared };
        setRows((prev) => ({ ...prev, [month]: cleared }));
        if (!row.id) return;
        try {
          await fetch(`/api/records/${row.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activity_value: null, meter_number: null, notes: null }),
          });
        } catch { /* 忽略；畫面已清 */ }
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
                        <input type="number" min="0" step="any" placeholder="採購量"
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
                      <td className="px-2 py-1.5 text-center text-xs whitespace-nowrap">
                        {row.saveStatus === 'saving' && '⏳'}
                        {row.saveStatus === 'saved' && '✓'}
                        {row.saveStatus === 'error' && '❌'}
                        <button onClick={() => clearMonth(m)} disabled={!row.id || row.is_reviewed}
                          title={row.is_reviewed ? '已查核不可清空，請先取消查核' : '清空此月數值'}
                          className={`ml-1 text-sm leading-none transition ${!row.id || row.is_reviewed ? 'text-gray-200 cursor-not-allowed' : 'text-gray-400 hover:text-red-500 cursor-pointer'}`}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: '#f0fdf4' }} className="font-semibold text-sm">
                  <td className="px-3 py-2 text-gray-700">合計</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-700">
                    {totalVol.toLocaleString(undefined, { maximumFractionDigits: 10 })} {source.default_unit}
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
        {processSources.length > 0 && (
          <ProcessSection source={{ ...processSources[0], name_zh: '焊條', source_code: '1-3' }} />
        )}
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
      const [cleared, setCleared] = useState<Set<number>>(new Set());
      const [reviewedOverride, setReviewedOverride] = useState<Record<number, boolean>>({});
      const [selected, setSelected] = useState<Set<number>>(new Set());
      const tmr = useRef<ReturnType<typeof setTimeout> | null>(null);

      // 查核 toggle（未查核才會被 /summary 等彙總納入計算，見 CLAUDE.md 業務規則）
      async function toggleReview(month: number, recordId: string, current: boolean) {
        const newVal = !current;
        setReviewedOverride((prev) => ({ ...prev, [month]: newVal }));
        try {
          await fetch(`/api/records/${recordId}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_reviewed: newVal }),
          });
        } catch { /* 失敗則畫面暫時領先於伺服器，重新整理後會校正 */ }
      }

      // 刪除某月（真正 DELETE 該筆紀錄，資料庫 ON DELETE CASCADE 會一併刪除其單據明細；
      // 不同於「清空數值」只把 activity_value 設 null，明細會殘留）
      async function deleteWasteMonth(month: number, recordId: string) {
        setSecStatus('saving');
        try {
          const res = await fetch(`/api/records/${recordId}`, { method: 'DELETE' });
          if (!res.ok) {
            const j = await res.json().catch(() => null);
            throw new Error(j?.error ?? `HTTP ${res.status}`);
          }
          const next = { ...lvRef.current, [month]: '' };
          lvRef.current = next; setLv(next);
          setCleared((prev) => new Set(prev).add(month));
          setSecStatus('saved'); setTimeout(() => setSecStatus('idle'), 2000);
        } catch (err) {
          setSecStatus('error');
          alert(err instanceof Error ? err.message : '刪除失敗');
        }
      }

      function monthsWithRecord(): number[] {
        return months.filter((m) => existingRecords.some((r) => r.emission_source_id === source.id && r.month === m));
      }

      function targetMonths(): number[] {
        const withRecord = monthsWithRecord();
        return selected.size > 0 ? withRecord.filter((m) => selected.has(m)) : withRecord;
      }

      async function bulkReview() {
        const targets = targetMonths().filter((m) => {
          const existing = existingRecords.find((r) => r.emission_source_id === source.id && r.month === m);
          const isReviewed = reviewedOverride[m] ?? existing?.is_reviewed ?? false;
          return existing?.id && !isReviewed;
        });
        await Promise.all(targets.map((m) => {
          const existing = existingRecords.find((r) => r.emission_source_id === source.id && r.month === m)!;
          return toggleReview(m, existing.id, false);
        }));
        setSelected(new Set());
      }

      async function bulkDelete() {
        const targets = targetMonths().filter((m) => {
          const existing = existingRecords.find((r) => r.emission_source_id === source.id && r.month === m);
          const isReviewed = reviewedOverride[m] ?? existing?.is_reviewed ?? false;
          return existing?.id && !isReviewed;
        });
        if (targets.length === 0) return;
        if (!confirm(`確定要刪除 ${targets.length} 筆尚未查核的資料？`)) return;
        await Promise.all(targets.map((m) => {
          const existing = existingRecords.find((r) => r.emission_source_id === source.id && r.month === m)!;
          return deleteWasteMonth(m, existing.id);
        }));
        setSelected(new Set());
      }

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

      const recordMonths = monthsWithRecord();
      const allSelected = recordMonths.length > 0 && recordMonths.every((m) => selected.has(m));

      return (
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <h3 className="text-base font-semibold text-gray-800">{source.name_zh}</h3>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
              {formatMethods(cfg)}
            </span>
            {secStatus !== 'idle' && (
              <span className={`text-xs ${secStatus === 'saving' ? 'text-yellow-500' : secStatus === 'saved' ? 'text-green-500' : 'text-red-500'}`}>
                {secStatus === 'saving' ? '⏳ 儲存中' : secStatus === 'saved' ? '✅ 已儲存' : '❌ 失敗'}
              </span>
            )}
            <div className="flex items-center gap-2 ml-auto">
              <button onClick={bulkReview} disabled={recordMonths.length === 0}
                className="px-3 py-1 rounded-lg text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: '#0C3D2E' }}>
                全選查核
              </button>
              <button onClick={bulkDelete} disabled={recordMonths.length === 0}
                className="px-3 py-1 rounded-lg text-xs font-medium border border-red-300 text-red-600 hover:bg-red-50 transition disabled:opacity-40 disabled:cursor-not-allowed">
                全選刪除
              </button>
            </div>
          </div>
          <table className="w-full border-collapse text-sm max-w-lg">
            <thead>
              <tr style={{ backgroundColor: '#0C3D2E' }} className="text-white">
                <th className="px-2 py-2 text-center w-8">
                  <input type="checkbox" checked={allSelected}
                    onChange={(e) => setSelected(e.target.checked ? new Set(recordMonths) : new Set())}
                    className="accent-green-600" />
                </th>
                <th className="px-4 py-2 text-left w-16">月份</th>
                <th className="px-4 py-2 text-right">廢棄物重量 (kg)</th>
                <th className="px-3 py-2 text-center w-16">明細</th>
                <th className="px-4 py-2 text-right w-32">CO₂e (t)</th>
                <th className="px-2 py-2 text-center w-10">查核</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => {
                const existing = existingRecords.find(
                  (r) => r.emission_source_id === source.id && r.month === m,
                );
                const val = lv[m] ?? (existing?.activity_value != null ? String(existing.activity_value) : '');
                const isReviewed = reviewedOverride[m] ?? existing?.is_reviewed ?? false;
                return (
                  <tr key={m} className={m % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                    <td className="px-2 py-1.5 text-center">
                      {existing?.id && (
                        <input type="checkbox" checked={selected.has(m)}
                          onChange={(e) => setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(m); else next.delete(m);
                            return next;
                          })}
                          className="accent-green-600" />
                      )}
                    </td>
                    <td className="px-4 py-1.5 font-medium text-gray-700">{m} 月</td>
                    <td className="px-4 py-1.5">
                      <input type="number" min="0" step="any" placeholder="輸入重量"
                        value={val}
                        onChange={(e) => onWasteChange(m, e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <LineItemsCell recordId={existing?.id ?? null} count={existing?.line_items_count ?? 0}
                        title={`${source.name_zh} ${m} 月`} unit="kg" sourceCode={source.source_code} />
                    </td>
                    <td className="px-4 py-1.5 text-right text-gray-400 text-xs font-mono whitespace-nowrap">
                      {!cleared.has(m) && existing?.co2e_total != null ? existing.co2e_total.toFixed(4) : '—'}
                      <button onClick={() => existing?.id && deleteWasteMonth(m, existing.id)} disabled={!existing?.id || isReviewed}
                        title={isReviewed ? '已查核不可刪除，請先取消查核' : '刪除此月數值與明細'}
                        className={`ml-2 text-sm leading-none transition ${!existing?.id || isReviewed ? 'text-gray-200 cursor-not-allowed' : 'text-gray-400 hover:text-red-500 cursor-pointer'}`}>
                        ✕
                      </button>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button onClick={() => existing?.id && toggleReview(m, existing.id, isReviewed)}
                        disabled={!existing?.id}
                        className="text-xl leading-none disabled:opacity-30"
                        title={isReviewed ? '取消查核' : '標記已查核'}>
                        {isReviewed ? '✅' : '⬜'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-green-50 font-semibold">
                <td />
                <td className="px-4 py-2 text-gray-700">合計</td>
                <td className="px-4 py-2 text-right text-gray-700 font-mono">{total.toLocaleString(undefined, { maximumFractionDigits: 10 })} kg</td>
                <td />
                <td className="px-4 py-2 text-right text-gray-700 font-mono">
                  {co2eTotal > 0 ? co2eTotal.toFixed(4) + ' t' : '—'}
                </td>
                <td />
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

  // ─── EnergyTab 3.3：電力 T&D 損失（唯讀，自動帶入已查核 S2 電力）──────
  function EnergyTab() {
    if (!elecSource) {
      return <p className="text-gray-500 py-8 text-center">找不到電力排放源（代碼 2-1-A），無法計算 T&D 損失。</p>;
    }
    const elecId = elecSource.id;
    // 只採計「已查核」的 S2 電力
    const reviewed = enrichedRecords.filter(
      (r) => r.emission_source_id === elecId && r.is_reviewed && r.activity_value != null && Number(r.activity_value) > 0,
    );
    const unreviewedCount = enrichedRecords.filter(
      (r) => r.emission_source_id === elecId && !r.is_reviewed && r.activity_value != null && Number(r.activity_value) > 0,
    ).length;

    const byMonth: Record<number, number> = {};
    for (const r of reviewed) byMonth[r.month] = (byMonth[r.month] ?? 0) + Number(r.activity_value);
    const totalKwh = Object.values(byMonth).reduce((s, v) => s + v, 0);

    // T&D 係數取自範疇三 3-3-A 係數（scope3_factor，單位 tCO₂/MWh）
    const tdFactor = assignedFactors.find((f) => f.source_code === '3-3-A')?.scope3_factor ?? null;
    const tdVal = tdFactor != null ? Number(tdFactor) : null;
    // T&D tCO₂e = 電力(kWh) × 係數(tCO₂/MWh) ÷ 1000
    const co2eOf = (kwh: number) => (tdVal != null ? kwh * tdVal / 1000 : null);
    const totalCo2e = co2eOf(totalKwh);

    return (
      <div>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-800">燃料及能源相關 3.3 — 電力 T&amp;D 損失</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            本頁自動帶入「已查核」的範疇二電力數據，乘上 T&amp;D 損失係數計算，<strong>無需手動填寫</strong>。
          </p>
        </div>

        {tdVal == null && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            尚未指派 T&amp;D 損失係數給本廠。請至
            <a href="/admin/factors" className="underline mx-1 font-medium">係數設定</a>
            建立範疇三「3-3-A T&amp;D損失」係數（單位 tCO₂/MWh）並指派本廠後，本頁即自動計算。
          </div>
        )}
        {unreviewedCount > 0 && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
            尚有 {unreviewedCount} 筆電力數據未查核，未納入下方計算。請先於「電力 S2」分頁完成查核。
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-gray-200 max-w-2xl">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: HEADER_BG }} className="text-white">
                <th className="px-4 py-2 text-left w-20">月份</th>
                <th className="px-4 py-2 text-right">已查核電力 (kWh)</th>
                <th className="px-4 py-2 text-right">T&amp;D 損失 (tCO₂e)</th>
              </tr>
            </thead>
            <tbody>
              {MONTHS.map((m) => {
                const kwh = byMonth[m] ?? 0;
                const c = co2eOf(kwh);
                return (
                  <tr key={m} className={m % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                    <td className="px-4 py-1.5 font-medium text-gray-700">{m} 月</td>
                    <td className="px-4 py-1.5 text-right font-mono text-gray-600">
                      {kwh > 0 ? kwh.toLocaleString(undefined, { maximumFractionDigits: 10 }) : '—'}
                    </td>
                    <td className="px-4 py-1.5 text-right font-mono text-gray-700">
                      {c != null && kwh > 0 ? c.toFixed(4) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ backgroundColor: '#f0fdf4' }} className="font-semibold">
                <td className="px-4 py-2 text-gray-700">合計</td>
                <td className="px-4 py-2 text-right font-mono text-gray-700">
                  {totalKwh.toLocaleString(undefined, { maximumFractionDigits: 10 })} kWh
                </td>
                <td className="px-4 py-2 text-right font-mono text-green-800">
                  {totalCo2e != null ? totalCo2e.toFixed(4) + ' t' : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {tdVal != null && (
          <p className="text-xs text-gray-400 mt-2">
            計算：已查核電力(kWh) × T&amp;D 係數 {tdVal} (tCO₂/MWh) ÷ 1000 = tCO₂e ｜ 數值為 AI 計算，需相關部門複核
          </p>
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
    const [records, setRecords] = useState<ActivityRecord[]>(existingRecords);
    const [loading, setLoading] = useState(false);
    const [recalcMsg, setRecalcMsg] = useState('');
    const [freshRecMwh, setFreshRecMwh] = useState(recMwh);

    function fetchLatest() {
      return Promise.all([
        fetch(`/api/records?factory_id=${factory.id}&year=${year}`).then((r) => r.json()),
        fetch(`/api/rec-certificates?factory_id=${factory.id}&year=${year}`).then((r) => r.json()),
      ]).then(([recData, recCerts]) => {
        if (recData.data) setRecords(recData.data);
        if (recCerts.data) {
          const total = (recCerts.data as { rec_kwh: number }[])
            .reduce((s: number, r) => s + (Number(r.rec_kwh) || 0), 0);
          setFreshRecMwh(total / 1000);
        }
      });
    }

    function refresh() {
      setLoading(true);
      fetchLatest().finally(() => setLoading(false));
    }

    async function runRecalc() {
      setLoading(true);
      setRecalcMsg('');
      try {
        const res = await fetch('/api/records/recalculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ factory_id: factory.id, year }),
        });
        const data = await res.json();
        if (!res.ok) {
          setRecalcMsg(`錯誤 ${res.status}：${data.error ?? '計算失敗'}`);
        } else {
          setRecalcMsg(data.message ?? '完成');
          await fetchLatest();
        }
      } catch {
        setRecalcMsg('計算失敗，請稍後再試');
      } finally {
        setLoading(false);
        setTimeout(() => setRecalcMsg(''), 8000);
      }
    }

    const sourceById = Object.fromEntries(emissionSources.map((s) => [s.id, s]));

    type SourceRow = {
      source: EmissionSource;
      annual_co2e: number;
      annual_co2_t: number | null;
      annual_ch4_t: number | null;
      annual_n2o_t: number | null;
      hasData: boolean;
      hasPending: boolean;
    };

    const reviewedRecords = records.filter((r) => r.is_reviewed);

    const sourceMap = new Map<string, SourceRow>();
    for (const r of reviewedRecords) {
      const src = sourceById[r.emission_source_id];
      if (!src) continue;
      if (!sourceMap.has(r.emission_source_id)) {
        sourceMap.set(r.emission_source_id, {
          source: src,
          annual_co2e: 0,
          annual_co2_t: null,
          annual_ch4_t: null,
          annual_n2o_t: null,
          hasData: false,
          hasPending: false,
        });
      }
      const row = sourceMap.get(r.emission_source_id)!;
      const co2e = r.co2e_total != null ? Number(r.co2e_total) : null;
      if (co2e != null) {
        row.annual_co2e += co2e;
        row.hasData = true;
      } else if (r.activity_value != null && r.activity_value > 0) {
        row.hasData = true;
        row.hasPending = true;
      }
      if (r.co2_t != null) row.annual_co2_t = (row.annual_co2_t ?? 0) + Number(r.co2_t);
      if (r.ch4_t != null) row.annual_ch4_t = (row.annual_ch4_t ?? 0) + Number(r.ch4_t);
      if (r.n2o_t != null) row.annual_n2o_t = (row.annual_n2o_t ?? 0) + Number(r.n2o_t);
    }

    const activeRows = Array.from(sourceMap.values()).filter((r) => r.hasData);

    const scopeGroups: { scope: number; label: string; cats: { cat: string; rows: SourceRow[] }[] }[] = [
      { scope: 1, label: 'Scope 1 直接排放', cats: [] },
      { scope: 2, label: 'Scope 2 間接排放（能源）', cats: [] },
      { scope: 3, label: 'Scope 3 其他間接排放', cats: [] },
    ];
    // 依 GHG Protocol Scope 3 類別編號排序分組（Cat1/3/4/5/6/7/9），不用資料庫裡不一致的
    // category 欄位（新舊排放源分別存過中文/英文 snake_case，字串不統一會拆成重複分類、
    // 且插入順序不保證符合協議編號順序）
    for (const sg of scopeGroups) {
      const scopeRows = activeRows.filter((r) => r.source.scope === sg.scope);
      const matched = new Set<SourceRow>();
      for (const { prefix, label } of CAT_ORDER) {
        const rows = scopeRows.filter((r) => r.source.source_code.startsWith(prefix));
        if (rows.length === 0) continue;
        rows.forEach((r) => matched.add(r));
        sg.cats.push({ cat: label, rows });
      }
      const leftover = scopeRows.filter((r) => !matched.has(r));
      if (leftover.length > 0) sg.cats.push({ cat: '其他', rows: leftover });
    }

    function scopeCo2eTotal(scope: number): number {
      if (scope === 2) {
        return reviewedRecords.filter((r) => sourceById[r.emission_source_id]?.scope === 2)
          .reduce((s, r) => s + (Number(r.co2e_location) || Number(r.co2e_total) || 0), 0);
      }
      return activeRows.filter((r) => r.source.scope === scope).reduce((s, r) => s + r.annual_co2e, 0);
    }

    const s1Total = scopeCo2eTotal(1);
    const s2LocTotal = scopeCo2eTotal(2);
    const s3Total = scopeCo2eTotal(3);
    const grandTotal = s1Total + s2LocTotal + s3Total;

    const s2MarketTotal = reviewedRecords
      .filter((r) => sourceById[r.emission_source_id]?.scope === 2)
      .reduce((s, r) => s + (Number(r.co2e_market) || 0), 0);
    const biomassTotal = reviewedRecords.reduce((s, r) => s + (Number(r.co2e_biomass_co2) || 0), 0);
    const s2Deducted = s2LocTotal - s2MarketTotal;
    const s1s2Loc = s1Total + s2LocTotal;
    const s1s2Mkt = s1Total + s2MarketTotal;
    const s1s2s3Loc = s1Total + s2LocTotal + s3Total;
    const s1s2s3Mkt = s1Total + s2MarketTotal + s3Total;

    // nullCount: reviewed records that are pending calculation
    const nullCount = reviewedRecords.filter((r) => r.activity_value != null && r.activity_value > 0 && r.co2e_total == null).length;

    function fmtG(v: number | null): string {
      if (v == null) return '—';
      return v === 0 ? '0' : v.toFixed(4);
    }
    function fmtN(v: number): string { return v === 0 ? '—' : v.toFixed(4); }

    return (
      <div className="w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-gray-800">
            碳排彙總 — {factory.name_zh} {year} 年
          </h2>
          <div className="flex items-center gap-2">
            {recalcMsg && (
              <span className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded">{recalcMsg}</span>
            )}
            <button
              onClick={runRecalc}
              disabled={loading}
              className="px-3 py-1.5 text-xs bg-blue-700 text-white rounded-lg hover:bg-blue-600 transition disabled:opacity-50"
              title="補算所有尚未計算 CO₂e 的記錄"
            >
              {loading ? '計算中…' : '⚡ 批次計算 CO₂e'}
            </button>
            <button
              onClick={refresh}
              disabled={loading}
              className="px-3 py-1.5 text-xs bg-green-700 text-white rounded-lg hover:bg-green-600 transition disabled:opacity-50"
            >
              {loading ? '更新中…' : '↻ 重新整理'}
            </button>
          </div>
        </div>

        {nullCount > 0 && (
          <div className="mb-4 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
            ⚠️ 有 {nullCount} 筆已填報資料尚未完成 CO₂e 計算，請點選「批次計算 CO₂e」後再重新整理。
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Scope 1', val: s1Total, color: 'bg-orange-50 border-orange-200 text-orange-800' },
            { label: 'Scope 2 地域', val: s2LocTotal, color: 'bg-blue-50 border-blue-200 text-blue-800' },
            { label: 'Scope 3', val: s3Total, color: 'bg-purple-50 border-purple-200 text-purple-800' },
            { label: '全年合計', val: grandTotal, color: 'bg-green-50 border-green-200 text-green-800' },
          ].map(({ label, val, color }) => (
            <div key={label} className={`border rounded-xl p-4 ${color}`}>
              <div className="text-xs mb-1 opacity-70">{label}</div>
              <div className="text-2xl font-bold">{val.toFixed(4)}</div>
              <div className="text-xs opacity-60 mt-0.5">tCO₂e</div>
            </div>
          ))}
        </div>

        {/* Gas breakdown table */}
        {activeRows.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm border border-dashed border-gray-200 rounded-xl mb-6">
            尚無填報資料，請先在各排放源分頁輸入活動數據。
          </div>
        ) : (
          <div className="overflow-x-auto border border-gray-200 rounded-xl mb-6">
            <table className="w-full text-xs border-collapse" style={{ minWidth: '640px' }}>
              <thead>
                <tr className="bg-gray-800 text-white">
                  <th className="sticky left-0 bg-gray-800 px-3 py-2 text-left w-28">代碼</th>
                  <th className="px-3 py-2 text-left">排放源名稱</th>
                  <th className="px-3 py-2 text-right w-28">CO₂ (tCO₂)</th>
                  <th className="px-3 py-2 text-right w-28">CH₄ (tCH₄)</th>
                  <th className="px-3 py-2 text-right w-28">N₂O (tN₂O)</th>
                  <th className="px-3 py-2 text-right w-28 font-bold">CO₂e (tCO₂e)</th>
                </tr>
              </thead>
              <tbody>
                {scopeGroups.map((sg) => {
                  if (sg.cats.length === 0) return null;
                  const stCo2e = activeRows.filter((r) => r.source.scope === sg.scope)
                    .reduce((s, r) => s + r.annual_co2e, 0);
                  const stCo2 = activeRows.filter((r) => r.source.scope === sg.scope)
                    .reduce<number | null>((s, r) => r.annual_co2_t != null ? (s ?? 0) + r.annual_co2_t : s, null);
                  const stCh4 = activeRows.filter((r) => r.source.scope === sg.scope)
                    .reduce<number | null>((s, r) => r.annual_ch4_t != null ? (s ?? 0) + r.annual_ch4_t : s, null);
                  const stN2o = activeRows.filter((r) => r.source.scope === sg.scope)
                    .reduce<number | null>((s, r) => r.annual_n2o_t != null ? (s ?? 0) + r.annual_n2o_t : s, null);
                  return (
                    <>
                      <tr key={`scope-${sg.scope}`} className="bg-gray-100">
                        <td colSpan={6} className="px-3 py-1.5 font-semibold text-gray-700 text-xs">
                          {sg.label}
                        </td>
                      </tr>
                      {sg.cats.flatMap(({ cat, rows }) => [
                        <tr key={`cat-${sg.scope}-${cat}`} className="bg-gray-50">
                          <td className="sticky left-0 bg-gray-50 px-3 py-1 text-gray-500 pl-6">{cat}</td>
                          <td colSpan={5} />
                        </tr>,
                        ...rows.map((row, idx) => (
                          <tr key={row.source.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                            <td className="sticky left-0 bg-inherit px-3 py-1.5 font-mono text-gray-500 pl-8 text-xs">{row.source.source_code}</td>
                            <td className="px-3 py-1.5 text-gray-700 truncate" title={row.source.name_zh}>{row.source.name_zh}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-gray-600">{fmtG(row.annual_co2_t)}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-gray-600">{fmtG(row.annual_ch4_t)}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-gray-600">{fmtG(row.annual_n2o_t)}</td>
                            <td className="px-3 py-1.5 text-right font-mono font-semibold text-gray-800">
                              {row.hasPending && row.annual_co2e === 0 ? <span className="text-amber-400">待計算</span> : fmtN(row.annual_co2e)}
                            </td>
                          </tr>
                        )),
                      ])}
                      <tr key={`stotal-${sg.scope}`} className="bg-gray-200 font-semibold">
                        <td colSpan={2} className="sticky left-0 bg-gray-200 px-3 py-1.5 text-gray-700 pl-4">
                          {sg.label} 小計
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">{fmtG(stCo2)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{fmtG(stCh4)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{fmtG(stN2o)}</td>
                        <td className="px-3 py-1.5 text-right font-mono font-bold">{fmtN(stCo2e)}</td>
                      </tr>
                    </>
                  );
                })}
                <tr className="bg-gray-800 text-white font-bold">
                  <td colSpan={2} className="sticky left-0 bg-gray-800 px-3 py-2">全年碳排合計</td>
                  <td className="px-3 py-2 text-right font-mono">—</td>
                  <td className="px-3 py-2 text-right font-mono">—</td>
                  <td className="px-3 py-2 text-right font-mono">—</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtN(grandTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Supplementary disclosure */}
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-gray-700 text-white px-4 py-2 text-sm font-semibold">補充揭露</div>
          <table className="w-full text-sm border-collapse">
            <tbody>
              {[
                { label: '生質 CO₂ 排放量（Biomass CO₂）', val: biomassTotal, unit: 'tCO₂', highlight: false, indent: false },
                { label: 'S2 市場（Market-Based）', val: s2MarketTotal, unit: 'tCO₂e', highlight: false, indent: false },
                { label: '↳ iREC 購入量', val: freshRecMwh, unit: 'MWh', highlight: false, indent: true },
                { label: '↳ S2 iREC 扣減量（地域 − 市場）', val: s2Deducted, unit: 'tCO₂e', highlight: false, indent: true },
                { label: 'S1 + S2 地域合計', val: s1s2Loc, unit: 'tCO₂e', highlight: true, indent: false },
                { label: 'S1 + S2 市場合計', val: s1s2Mkt, unit: 'tCO₂e', highlight: true, indent: false },
                { label: 'S1 + S2 + S3 地域合計', val: s1s2s3Loc, unit: 'tCO₂e', highlight: true, indent: false },
                { label: 'S1 + S2 + S3 市場合計', val: s1s2s3Mkt, unit: 'tCO₂e', highlight: true, indent: false },
              ].map(({ label, val, unit, highlight, indent }, i) => (
                <tr key={label} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} border-b border-gray-100`}>
                  <td className={`px-4 py-2 ${indent ? 'pl-8' : ''} ${highlight ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>
                    {label}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono ${highlight ? 'font-bold text-gray-900' : 'text-gray-700'}`}>
                    {val.toFixed(4)} {unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ─── FactorPanel：顯示當前 tab 的係數資訊 ───────────────────
  function FactorPanel() {
    const [expanded, setExpanded] = useState(false);
    const grp = SOURCE_GROUPS.find((g) => g.tabId === activeTab);
    if (!grp) return null;

    const tabSources = emissionSources.filter((s) => s.source_code.startsWith(grp.prefix));
    const tabFactors = tabSources
      .map((s) => ({ source: s, factor: factorBySourceId[s.id] ?? null }))
      .filter((x) => x.factor !== null);

    if (tabFactors.length === 0) return null;

    function fmtNum(v: number | null, digits = 10): string {
      if (v === null || v === undefined) return '—';
      const n = Number(v); // 防禦：NUMERIC 可能以字串回傳，避免 .toFixed 例外
      if (Number.isNaN(n)) return '—';
      return n.toFixed(digits);
    }

    // ─── 逸散 tab：客製化係數預覽 ────────────────────────────
    if (activeTab === 'fugitive') {
      const selFactors = tabFactors.filter(({ source }) => selectedSourceIds.has(source.id));
      if (selFactors.length === 0) return null;
      const SEPTIC_GWP_CH4_DEFAULT = 27;
      return (
        <div className="mt-6 border border-blue-100 rounded-xl bg-blue-50/40">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="w-full flex items-center justify-between px-4 py-3 text-left">
            <span className="text-sm font-semibold text-blue-700">
              逸散係數（{selFactors.length} 個排放源，{year} 年）
            </span>
            <span className="text-blue-400 text-sm">{expanded ? '▲ 收起' : '▼ 展開查看'}</span>
          </button>
          {expanded && (
            <div className="px-4 pb-4 space-y-2">
              {selFactors.map(({ source, factor }) => {
                const isSeptic = source.source_code === '1-4B-1';
                const isSF6 = source.source_code === '1-4D-1';
                const isRefrig = source.source_code.startsWith('1-4A');

                if (isRefrig) {
                  return (
                    <div key={source.id} className="flex items-center gap-3 text-xs bg-white rounded-lg px-3 py-2 border border-blue-100">
                      <span className="font-mono text-gray-400 w-16 flex-shrink-0">{source.source_code}</span>
                      <span className="text-gray-800 flex-1">{source.name_zh}</span>
                      <span className="text-gray-500 text-xs">HFCs GWP</span>
                      <span className="font-mono font-bold text-blue-700 text-sm">
                        {factor!.factor_substance != null ? Number(factor!.factor_substance).toLocaleString() : '—'}
                      </span>
                    </div>
                  );
                }

                if (isSF6) {
                  return (
                    <div key={source.id} className="flex items-center gap-3 text-xs bg-white rounded-lg px-3 py-2 border border-purple-100">
                      <span className="font-mono text-gray-400 w-16 flex-shrink-0">{source.source_code}</span>
                      <span className="text-gray-800 flex-1">{source.name_zh}</span>
                      <span className="text-gray-500 text-xs">SF₆ GWP</span>
                      <span className="font-mono font-bold text-purple-700 text-sm">
                        {factor!.factor_substance != null ? Number(factor!.factor_substance).toLocaleString() : '—'}
                      </span>
                    </div>
                  );
                }

                if (isSeptic) {
                  const srcRecs = existingRecords.filter((r) => r.emission_source_id === source.id);
                  const totalHoursY = srcRecs.reduce((s, r) => s + (Number(r.activity_value) || 0), 0);
                  const BOD = Number(factor!.factor_co2) || 0;
                  const Bo  = Number(factor!.factor_ch4) || 0;
                  const MCF = Number(factor!.factor_substance) || 0;
                  const CH4_CARBON_MASS_RATIO = 16 / 12;
                  const CH4_GWP = factor!.gwp_ch4 != null ? Number(factor!.gwp_ch4) : SEPTIC_GWP_CH4_DEFAULT;
                  const ch4T = BOD > 0 && Bo > 0 && MCF > 0 && totalHoursY > 0
                    ? totalHoursY * BOD * Bo * MCF * CH4_CARBON_MASS_RATIO / 24 / 1000
                    : null;
                  return (
                    <div key={source.id} className="text-xs bg-white rounded-lg px-3 py-2.5 border border-teal-100">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-mono text-gray-400">{source.source_code}</span>
                        <span className="font-semibold text-gray-700">{source.name_zh}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-6 gap-y-1 mb-2">
                        <span className="text-gray-500">BOD = <span className="font-mono font-semibold text-gray-700">{factor!.factor_co2 != null ? Number(factor!.factor_co2) : '—'}</span> kg CH₄/人·日</span>
                        <span className="text-gray-500">Bo = <span className="font-mono font-semibold text-gray-700">{factor!.factor_ch4 != null ? Number(factor!.factor_ch4) : '—'}</span> kg CH₄/kg BOD</span>
                        <span className="text-gray-500">MCF = <span className="font-mono font-semibold text-gray-700">{factor!.factor_substance != null ? Number(factor!.factor_substance) : '—'}</span></span>
                      </div>
                      <div className="flex flex-wrap gap-x-6 gap-y-1">
                        <span className="text-gray-500">CH₄ 排放 (T/YEAR) = <span className="font-mono font-bold text-teal-700">
                          {ch4T != null ? ch4T.toFixed(4) + ' t' : '尚無填報資料'}
                        </span></span>
                        <span className="text-gray-500">CH₄ GWP = <span className="font-mono font-semibold text-gray-700">{CH4_GWP}</span></span>
                      </div>
                    </div>
                  );
                }

                // 滅火器 1-4C
                return (
                  <div key={source.id} className="flex items-center gap-3 text-xs bg-white rounded-lg px-3 py-2 border border-gray-200">
                    <span className="font-mono text-gray-400 w-16 flex-shrink-0">{source.source_code}</span>
                    <span className="text-gray-800 flex-1">{source.name_zh}</span>
                    <span className="text-gray-500 text-xs">CO₂ EF</span>
                    <span className="font-mono font-bold text-gray-700 text-sm">
                      {factor!.factor_substance != null ? Number(factor!.factor_substance).toLocaleString(undefined, { maximumFractionDigits: 10 }) : fmtNum(factor!.factor_co2, 10)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="mt-6 border border-blue-100 rounded-xl bg-blue-50/40">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="w-full flex items-center justify-between px-4 py-3 text-left">
          <span className="text-sm font-semibold text-blue-700">
            適用係數（{tabFactors.length} 個排放源，{year} 年）
          </span>
          <span className="text-blue-400 text-sm">{expanded ? '▲ 收起' : '▼ 展開查看'}</span>
        </button>
        {expanded && (
          <div className="px-4 pb-4 overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-blue-600 border-b border-blue-200 text-right">
                  <th className="py-1.5 text-left font-semibold w-24">代碼</th>
                  <th className="py-1.5 text-left font-semibold pr-3">名稱</th>
                  <th className="py-1.5 font-semibold">CO₂ EF</th>
                  <th className="py-1.5 font-semibold">CH₄ EF</th>
                  <th className="py-1.5 font-semibold">N₂O EF</th>
                  <th className="py-1.5 font-semibold">電網 EF</th>
                  <th className="py-1.5 font-semibold">市場剩餘 EF</th>
                  <th className="py-1.5 font-semibold">S3 EF</th>
                  <th className="py-1.5 font-semibold">焚化係數</th>
                  <th className="py-1.5 font-semibold">回收係數</th>
                  <th className="py-1.5 font-semibold">掩埋係數</th>
                  <th className="py-1.5 font-semibold">NCV</th>
                  <th className="py-1.5 text-left font-semibold pl-3">來源</th>
                </tr>
              </thead>
              <tbody>
                {tabFactors.map(({ source, factor }, idx) => (
                  <tr key={source.id} className={idx % 2 === 0 ? 'bg-white/70' : ''}>
                    <td className="py-1.5 font-mono text-gray-500">{source.source_code}</td>
                    <td className="py-1.5 text-gray-800 pr-3">{source.name_zh}</td>
                    <td className="py-1.5 text-right font-mono">{fmtNum(factor!.factor_co2)}</td>
                    <td className="py-1.5 text-right font-mono">{fmtNum(factor!.factor_ch4)}</td>
                    <td className="py-1.5 text-right font-mono">{fmtNum(factor!.factor_n2o)}</td>
                    <td className="py-1.5 text-right font-mono">{fmtNum(factor!.grid_emission_factor)}</td>
                    <td className="py-1.5 text-right font-mono">{fmtNum(factor!.market_residual_factor)}</td>
                    <td className="py-1.5 text-right font-mono">{fmtNum(factor!.scope3_factor)}</td>
                    <td className="py-1.5 text-right font-mono">{fmtNum(factor!.waste_incineration_factor)}</td>
                    <td className="py-1.5 text-right font-mono">{fmtNum(factor!.waste_recycling_factor)}</td>
                    <td className="py-1.5 text-right font-mono">{fmtNum(factor!.waste_landfill_factor)}</td>
                    <td className="py-1.5 text-right font-mono pl-3">
                      {factor!.ncv != null ? `${factor!.ncv} ${factor!.ncv_unit ?? ''}` : '—'}
                    </td>
                    <td className="py-1.5 pl-3 text-gray-400 truncate max-w-[10rem]" title={factor!.source_reference ?? ''}>
                      {factor!.source_reference ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-blue-300 mt-2">
              範疇一 EF 單位：kg/TJ；範疇二電網 EF：tCO₂e/MWh；S3：kg/kg 或 kg/tonne-km；廢棄物焚化/回收/掩埋係數：kg CO₂e/tonnes
            </p>
          </div>
        )}
      </div>
    );
  }

  // ─── TabContent ──────────────────────────────────────────────
  function TabContent() {
    switch (activeTab) {
      case 'basic':      return <BasicTab />;
      case 'elec':       return <ElecTab />;
      case 'waste':      return <WasteTab />;
      case 'fuel':       return <FuelTab factory={factory} year={year} emissionSources={emissionSources} selectedSourceIds={selectedSourceIds} existingRecords={enrichedRecords} setActiveTab={(t) => setActiveTab(t as TabId)} assignedFactors={assignedFactors} onReviewToggle={handleReviewToggle} />;
      case 'combustion': return <CombustionTab factory={factory} year={year} emissionSources={emissionSources} selectedSourceIds={selectedSourceIds} existingRecords={enrichedRecords} setActiveTab={(t) => setActiveTab(t as TabId)} assignedFactors={assignedFactors} onReviewToggle={handleReviewToggle} />;
      case 'fugitive':   return <FugitiveTab factory={factory} year={year} emissionSources={emissionSources} selectedSourceIds={selectedSourceIds} existingRecords={enrichedRecords} setActiveTab={(t) => setActiveTab(t as TabId)} onReviewToggle={handleReviewToggle} />;
      case 'process':    return <ProcessTab />;
      case 'purchase':   return <PurchaseTab factory={factory} year={year} emissionSources={emissionSources} selectedSourceIds={selectedSourceIds} existingRecords={enrichedRecords} setActiveTab={(t) => setActiveTab(t as TabId)} upstreamTons={upstreamTons} assignedFactors={assignedFactors} onReviewToggle={handleReviewToggle} />;
      case 'energy':     return <EnergyTab />;
      case 'upstream':   return null;  // always-mounted outside TabContent
      case 'downstream': return <DownstreamTab factory={factory} year={year} emissionSources={emissionSources} selectedSourceIds={selectedSourceIds} existingRecords={enrichedRecords} setActiveTab={(t) => setActiveTab(t as TabId)} onReviewToggle={handleReviewToggle} />;
      case 'travel':     return <TravelTab factory={factory} year={year} emissionSources={emissionSources} selectedSourceIds={selectedSourceIds} existingRecords={enrichedRecords} setActiveTab={(t) => setActiveTab(t as TabId)} onReviewToggle={handleReviewToggle} travelMode={travelConfig} />;
      case 'commute':    return <CommuteTab factory={factory} year={year} emissionSources={emissionSources} selectedSourceIds={selectedSourceIds} existingRecords={enrichedRecords} setActiveTab={(t) => setActiveTab(t as TabId)} onReviewToggle={handleReviewToggle} />;
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
                  onChange={(e) => router.push(`/fill/${e.target.value}?year=${year}`)}
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
              <div className="flex items-center gap-2">
                <span className="text-white font-semibold text-sm flex-shrink-0">盤查年度：</span>
                <select
                  value={year}
                  onChange={(e) => router.push(`/fill/${factory.factory_code}?year=${e.target.value}`)}
                  className="bg-green-800 text-white text-sm rounded px-2 py-1 border border-green-600 focus:outline-none focus:ring-2 focus:ring-green-400"
                >
                  {REPORT_YEARS.map((y) => (
                    <option key={y} value={y}>{y} 年</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-4 flex-shrink-0">
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
          selectedSourceIds={selectedSourceIds} existingRecords={enrichedRecords}
          setActiveTab={(t) => setActiveTab(t as TabId)}
          onTonsChange={(tons) => setUpstreamTons(tons)}
          onReviewToggle={handleReviewToggle} />
        {activeTab === 'upstream' && <FactorPanel />}
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6" style={{ display: activeTab === 'upstream' ? 'none' : undefined }}>
        <TabContent />
        {activeTab !== 'basic' && activeTab !== 'summary' && <FactorPanel />}
      </main>

      <footer className="text-center text-xs text-gray-400 py-6 border-t border-gray-200 mt-8">
        GHG 碳盤查系統 ｜ 資料僅供內部使用，請妥善保管填報連結
      </footer>

      {importModalOpen && (
        <ImportModal factory={factory} year={year} onClose={() => setImportModalOpen(false)} onImported={() => refreshRecords()} />
      )}
    </div>
  );
}
