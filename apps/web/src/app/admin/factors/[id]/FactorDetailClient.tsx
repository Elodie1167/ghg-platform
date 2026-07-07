'use client';

import { useState } from 'react';

const HEADER_BG = '#0C3D2E';

// AR6 GWP constants
const GWP_CO2 = 1;
const GWP_CH4 = 27.9;
const GWP_N2O = 273;

interface FactorDetail {
  id: string;
  emission_source_id: string;
  source_code: string;
  source_name_zh: string;
  scope: number;
  category: string;
  country_code: string;
  year: number;
  factor_co2: number | null;
  factor_ch4: number | null;
  factor_n2o: number | null;
  factor_substance: number | null;
  grid_emission_factor: number | null;
  market_residual_factor: number | null;
  scope3_factor: number | null;
  source_reference: string | null;
  ncv: number | null;
  ncv_unit: string | null;
  density: number | null;
  density_unit: string | null;
  assigned_factory_ids: string[];
}

interface Factory {
  id: string;
  factory_code: string;
  name_zh: string;
  country_code: string;
}

interface Props {
  factor: FactorDetail;
  factories: Factory[];
}

type EditState = Omit<FactorDetail,
  'id' | 'emission_source_id' | 'source_code' | 'source_name_zh' | 'scope' | 'category' | 'assigned_factory_ids'
>;

function n(v: number | null | undefined): string {
  return v != null ? String(v) : '';
}

function p(s: string): number | null {
  const v = parseFloat(s);
  return s === '' || isNaN(v) ? null : v;
}

interface FieldProps {
  label: string;
  value: string;
  unit?: string;
  onChange: (v: string) => void;
  hint?: string;
}

function NumField({ label, value, unit, onChange, hint }: FieldProps) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">
        {label}
        {hint && <span className="ml-1 text-gray-400">({hint})</span>}
      </label>
      <div className="flex items-center gap-1.5">
        <input type="number" step="any" value={value} onChange={(e) => onChange(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono w-44 focus:outline-none focus:ring-2 focus:ring-green-500" />
        {unit && <span className="text-xs text-gray-400 whitespace-nowrap">{unit}</span>}
      </div>
    </div>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: string;
}

function TextField({ label, value, onChange, placeholder, width = 'w-44' }: TextFieldProps) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className={`border border-gray-300 rounded-lg px-3 py-2 text-sm ${width} focus:outline-none focus:ring-2 focus:ring-green-500`} />
    </div>
  );
}

export default function FactorDetailClient({ factor, factories }: Props) {
  const [edit, setEdit] = useState<EditState>({
    country_code: factor.country_code,
    year: factor.year,
    factor_co2: factor.factor_co2,
    factor_ch4: factor.factor_ch4,
    factor_n2o: factor.factor_n2o,
    factor_substance: factor.factor_substance,
    grid_emission_factor: factor.grid_emission_factor,
    market_residual_factor: factor.market_residual_factor,
    scope3_factor: factor.scope3_factor,
    source_reference: factor.source_reference,
    ncv: factor.ncv,
    ncv_unit: factor.ncv_unit,
    density: factor.density,
    density_unit: factor.density_unit,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set(factor.assigned_factory_ids));
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignSaved, setAssignSaved] = useState(false);

  // preview inputs
  const [previewActivity, setPreviewActivity] = useState('1000');
  const [previewUnit, setPreviewUnit] = useState('kg');

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/factors/${factor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edit),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      alert('儲存失敗，請重試');
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignSave() {
    setAssignSaving(true);
    setAssignSaved(false);
    try {
      const res = await fetch(`/api/admin/factors/${factor.id}/assignments`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factory_ids: Array.from(assignedIds) }),
      });
      if (!res.ok) throw new Error();
      setAssignSaved(true);
      setTimeout(() => setAssignSaved(false), 3000);
    } catch {
      alert('廠區指定儲存失敗');
    } finally {
      setAssignSaving(false);
    }
  }

  function toggleFactory(id: string) {
    setAssignedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const groupedFactories = factories.reduce((acc, f) => {
    if (!acc[f.country_code]) acc[f.country_code] = [];
    acc[f.country_code].push(f);
    return acc;
  }, {} as Record<string, Factory[]>);

  // Live calculation preview
  const actVal = parseFloat(previewActivity) || 0;
  const ncv = edit.ncv ?? 0;
  const density = edit.density ?? 0;

  // If the input is in volume (L/m3), convert via density first
  const isVolume = previewUnit === 'L' || previewUnit === 'm³' || previewUnit === 'Nm³';
  const massKg = isVolume && density > 0 ? actVal * density : actVal;
  const energyMJ = ncv > 0 ? massKg * ncv : 0;
  const energyTJ = energyMJ / 1_000_000;
  const tonCO2 = edit.factor_co2 != null && energyTJ > 0 ? energyTJ * edit.factor_co2 / 1000 : null;
  const tonCH4 = edit.factor_ch4 != null && energyTJ > 0 ? energyTJ * edit.factor_ch4 / 1000 : null;
  const tonN2O = edit.factor_n2o != null && energyTJ > 0 ? energyTJ * edit.factor_n2o / 1000 : null;
  const co2eq = (tonCO2 != null || tonCH4 != null || tonN2O != null)
    ? ((tonCO2 ?? 0) * GWP_CO2 + (tonCH4 ?? 0) * GWP_CH4 + (tonN2O ?? 0) * GWP_N2O)
    : null;

  // Grid-based quick calc
  const gridCO2eq = edit.grid_emission_factor != null
    ? actVal * edit.grid_emission_factor / 1000
    : null;

  function fmtNum(v: number | null, d = 6): string {
    return v != null ? v.toFixed(d) : '—';
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div style={{ backgroundColor: HEADER_BG }} className="text-white px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/admin/factors" className="text-green-300 hover:text-white text-sm">← 返回係數列表</a>
            <span className="text-green-600">|</span>
            <div>
              <span className="text-xs text-green-300">S{factor.scope} · {factor.source_code}</span>
              <h1 className="text-lg font-bold leading-tight">{factor.source_name_zh}</h1>
            </div>
          </div>
          <div className="text-right text-xs text-green-300">
            <div>{factor.country_code} · {factor.year} 年</div>
            <div className="text-green-500">{factor.category}</div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* Section 1: 熱值與密度換算 */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-800 text-sm">熱值與密度換算</h2>
              <p className="text-xs text-gray-400 mt-0.5">固態／液態燃料需填入 NCV，液態需填密度以進行體積→重量換算</p>
            </div>
          </div>
          <div className="px-5 py-4 flex flex-wrap gap-5">
            <NumField label="淨發熱值 NCV" value={n(edit.ncv)} onChange={(v) => setEdit((e) => ({ ...e, ncv: p(v) }))} />
            <TextField label="NCV 單位" value={edit.ncv_unit ?? ''} onChange={(v) => setEdit((e) => ({ ...e, ncv_unit: v || null }))} placeholder="MJ/kg、MJ/L…" />
            <NumField label="密度" value={n(edit.density)} onChange={(v) => setEdit((e) => ({ ...e, density: p(v) }))} />
            <TextField label="密度單位" value={edit.density_unit ?? ''} onChange={(v) => setEdit((e) => ({ ...e, density_unit: v || null }))} placeholder="kg/L、kg/m³…" />
          </div>
          <div className="px-5 py-3 bg-amber-50 border-t border-amber-100 text-xs text-amber-700 font-mono">
            換算邏輯：Activity × NCV = 能量(MJ) → ÷ 1,000,000 = 能量(TJ) → × EF(kg/TJ) ÷ 1000 = 排放(ton) → × GWP = CO₂-eq(ton)
          </div>
        </div>

        {/* Section 2: 排放係數 */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800 text-sm">排放係數</h2>
            <p className="text-xs text-gray-400 mt-0.5">燃燒排放填 CO₂/CH₄/N₂O (kg/TJ)；電力填電網係數 (tCO₂/MWh)</p>
          </div>
          <div className="px-5 py-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <NumField label="EF CO₂" value={n(edit.factor_co2)} onChange={(v) => setEdit((e) => ({ ...e, factor_co2: p(v) }))} unit="kg CO₂/TJ" />
              <NumField label="EF CH₄" value={n(edit.factor_ch4)} onChange={(v) => setEdit((e) => ({ ...e, factor_ch4: p(v) }))} unit="kg CH₄/TJ" />
              <NumField label="EF N₂O" value={n(edit.factor_n2o)} onChange={(v) => setEdit((e) => ({ ...e, factor_n2o: p(v) }))} unit="kg N₂O/TJ" />
              <NumField label="物質/HFCs 係數" value={n(edit.factor_substance)} onChange={(v) => setEdit((e) => ({ ...e, factor_substance: p(v) }))} unit="tCO₂-eq/unit" />
            </div>
            {/* GWP 換算摘要 */}
            {(edit.factor_co2 != null || edit.factor_ch4 != null || edit.factor_n2o != null) && (() => {
              const total =
                (edit.factor_co2 ?? 0) * GWP_CO2 +
                (edit.factor_ch4 ?? 0) * GWP_CH4 +
                (edit.factor_n2o ?? 0) * GWP_N2O;
              return (
                <div className="flex flex-wrap items-center gap-2 p-3 bg-green-50 rounded-lg border border-green-100 text-xs font-mono">
                  <span className="font-sans text-gray-500 font-medium">CO₂-eq 合計 (per TJ)：</span>
                  {edit.factor_co2 != null && (
                    <span className="text-gray-700">{edit.factor_co2} × <span className="text-blue-600">1</span> <span className="text-gray-400">(CO₂)</span></span>
                  )}
                  {edit.factor_ch4 != null && (
                    <span className="text-gray-700">+ {edit.factor_ch4} × <span className="text-blue-600">27.9</span> <span className="text-gray-400">(CH₄)</span></span>
                  )}
                  {edit.factor_n2o != null && (
                    <span className="text-gray-700">+ {edit.factor_n2o} × <span className="text-blue-600">273</span> <span className="text-gray-400">(N₂O)</span></span>
                  )}
                  <span className="text-gray-400">=</span>
                  <span className="font-bold text-green-800 text-sm">{total.toFixed(2)} kg CO₂-eq/TJ</span>
                  <span className="text-gray-300 ml-1 font-sans">AR6 GWP</span>
                </div>
              );
            })()}

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2 border-t border-gray-100">
              <NumField label="電網排放係數 (Location)" value={n(edit.grid_emission_factor)} onChange={(v) => setEdit((e) => ({ ...e, grid_emission_factor: p(v) }))} unit="tCO₂/MWh" hint="S2 Location-Based" />
              <NumField label="市場剩餘係數 (Market)" value={n(edit.market_residual_factor)} onChange={(v) => setEdit((e) => ({ ...e, market_residual_factor: p(v) }))} unit="tCO₂/MWh" hint="S2 Market-Based" />
              <NumField label="S3 T&D 損失係數" value={n(edit.scope3_factor)} onChange={(v) => setEdit((e) => ({ ...e, scope3_factor: p(v) }))} unit="tCO₂/MWh" hint="S3" />
            </div>
            <div className="pt-2 border-t border-gray-100">
              <label className="block text-xs text-gray-500 mb-1">係數資料來源</label>
              <input type="text" value={edit.source_reference ?? ''} placeholder="如：IPCC 2006 Guideline、Taiwan EPA 2025…"
                onChange={(e) => setEdit((prev) => ({ ...prev, source_reference: e.target.value || null }))}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>
          <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-3 justify-end bg-gray-50">
            {saved && <span className="text-xs text-green-600 font-medium">✓ 已儲存</span>}
            <button onClick={handleSave} disabled={saving}
              className="px-6 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-60"
              style={{ backgroundColor: HEADER_BG }}>
              {saving ? '儲存中…' : '儲存係數'}
            </button>
          </div>
        </div>

        {/* Section 3: 計算預覽 */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800 text-sm">計算預覽</h2>
            <p className="text-xs text-gray-400 mt-0.5">輸入活動量，即時預覽 CO₂-eq 計算過程（AR6 GWP：CO₂=1, CH₄=27.9, N₂O=273）</p>
          </div>
          <div className="px-5 py-4">
            <div className="flex items-center gap-3 mb-5">
              <div>
                <label className="block text-xs text-gray-500 mb-1">活動量</label>
                <input type="number" step="any" value={previewActivity} onChange={(e) => setPreviewActivity(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono w-36 focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">單位</label>
                <input type="text" value={previewUnit} onChange={(e) => setPreviewUnit(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono w-24 focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
            </div>

            {/* Combustion calculation chain */}
            {(edit.ncv != null && edit.ncv > 0) && (
              <div className="space-y-2 font-mono text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="bg-blue-50 text-blue-800 px-2 py-1 rounded">{previewActivity} {previewUnit}</span>
                  {isVolume && density > 0 && (
                    <>
                      <span className="text-gray-400">× {edit.density} ({edit.density_unit})</span>
                      <span className="text-gray-400">=</span>
                      <span className="bg-blue-50 text-blue-800 px-2 py-1 rounded">{massKg.toFixed(3)} kg</span>
                    </>
                  )}
                  <span className="text-gray-400">× NCV {edit.ncv} ({edit.ncv_unit})</span>
                  <span className="text-gray-400">=</span>
                  <span className="bg-amber-50 text-amber-800 px-2 py-1 rounded">{energyMJ.toFixed(3)} MJ</span>
                  <span className="text-gray-400">= {energyTJ.toFixed(8)} TJ</span>
                </div>

                {tonCO2 != null && (
                  <div className="flex items-center gap-2 flex-wrap pl-4 border-l-2 border-gray-200">
                    <span className="text-gray-500">CO₂:</span>
                    <span>{energyTJ.toFixed(8)} TJ × {edit.factor_co2} kg/TJ ÷ 1000</span>
                    <span className="text-gray-400">=</span>
                    <span className="text-gray-700">{fmtNum(tonCO2, 6)} tCO₂</span>
                    <span className="text-gray-400">× {GWP_CO2}</span>
                    <span className="font-semibold text-green-700">{fmtNum(tonCO2 * GWP_CO2, 6)} tCO₂-eq</span>
                  </div>
                )}
                {tonCH4 != null && (
                  <div className="flex items-center gap-2 flex-wrap pl-4 border-l-2 border-gray-200">
                    <span className="text-gray-500">CH₄:</span>
                    <span>{energyTJ.toFixed(8)} TJ × {edit.factor_ch4} kg/TJ ÷ 1000</span>
                    <span className="text-gray-400">=</span>
                    <span className="text-gray-700">{fmtNum(tonCH4, 8)} tCH₄</span>
                    <span className="text-gray-400">× {GWP_CH4}</span>
                    <span className="font-semibold text-green-700">{fmtNum(tonCH4 * GWP_CH4, 6)} tCO₂-eq</span>
                  </div>
                )}
                {tonN2O != null && (
                  <div className="flex items-center gap-2 flex-wrap pl-4 border-l-2 border-gray-200">
                    <span className="text-gray-500">N₂O:</span>
                    <span>{energyTJ.toFixed(8)} TJ × {edit.factor_n2o} kg/TJ ÷ 1000</span>
                    <span className="text-gray-400">=</span>
                    <span className="text-gray-700">{fmtNum(tonN2O, 8)} tN₂O</span>
                    <span className="text-gray-400">× {GWP_N2O}</span>
                    <span className="font-semibold text-green-700">{fmtNum(tonN2O * GWP_N2O, 6)} tCO₂-eq</span>
                  </div>
                )}

                {co2eq != null && (
                  <div className="mt-3 p-3 bg-green-50 rounded-lg border border-green-200 flex items-center gap-3">
                    <span className="text-xs text-gray-600">{previewActivity} {previewUnit} 合計排放：</span>
                    <span className="text-lg font-bold text-green-800">{co2eq.toFixed(4)} tCO₂-eq</span>
                  </div>
                )}
              </div>
            )}

            {/* Grid-based quick calc */}
            {edit.grid_emission_factor != null && edit.ncv == null && (
              <div className="space-y-2 font-mono text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="bg-blue-50 text-blue-800 px-2 py-1 rounded">{previewActivity} kWh</span>
                  <span className="text-gray-400">× {edit.grid_emission_factor} tCO₂/MWh ÷ 1000</span>
                  <span className="text-gray-400">=</span>
                  <span className="bg-green-50 text-green-800 px-2 py-1 rounded font-semibold">
                    {gridCO2eq?.toFixed(6)} tCO₂-eq
                  </span>
                </div>
              </div>
            )}

            {edit.ncv == null && edit.grid_emission_factor == null && (
              <p className="text-xs text-gray-400 italic">請先填入 NCV（燃燒排放）或電網係數（電力）後，預覽才會顯示計算過程。</p>
            )}
          </div>
        </div>

        {/* Section 4: 廠區指定 */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-800 text-sm">適用廠區指定</h2>
              <p className="text-xs text-gray-400 mt-0.5">已選 {assignedIds.size} / {factories.length} 廠</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setAssignedIds(new Set(factories.map((f) => f.id)))}
                className="px-3 py-1 rounded-full text-xs font-medium text-white hover:opacity-90 transition"
                style={{ backgroundColor: HEADER_BG }}>全部廠區</button>
              <button onClick={() => setAssignedIds(new Set())}
                className="px-3 py-1 rounded-full text-xs font-medium border border-gray-300 hover:bg-gray-50 transition">清除全選</button>
            </div>
          </div>

          <div className="px-5 py-4">
            {Object.entries(groupedFactories).map(([cc, facs]) => (
              <div key={cc} className="mb-5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{cc}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {facs.map((fac) => (
                    <label key={fac.id}
                      className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition
                        ${assignedIds.has(fac.id) ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <input type="checkbox" checked={assignedIds.has(fac.id)} onChange={() => toggleFactory(fac.id)}
                        className="accent-green-600 shrink-0" />
                      <span className="text-xs">
                        <span className="font-mono font-semibold text-gray-700">{fac.factory_code}</span>
                        <br /><span className="text-gray-400">{fac.name_zh}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-3 justify-end bg-gray-50">
            {assignSaved && <span className="text-xs text-green-600 font-medium">✓ 廠區指定已儲存</span>}
            <button onClick={handleAssignSave} disabled={assignSaving}
              className="px-6 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-60"
              style={{ backgroundColor: HEADER_BG }}>
              {assignSaving ? '儲存中…' : '儲存廠區指定'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
