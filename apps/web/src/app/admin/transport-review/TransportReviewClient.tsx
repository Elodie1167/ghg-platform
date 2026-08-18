'use client';

import { useState } from 'react';

const HEADER_BG = '#0C3D2E';

export interface MissingItem {
  origin_raw: string | null;
  destination_raw: string | null;
  ship_mode_raw: string;
  calc_status: 'missing_distance' | 'pending_review';
  affected_count: number;
  factory_names: string[];
  factory_ids: string[];
  sample_raw_address: string | null;
  sample_vendor_name: string | null;
}

interface PortOption { id: string; standard_name: string; port_type: string; }
interface FactoryOption { id: string; factory_code: string; name_zh: string; }

interface Props {
  initialItems: MissingItem[];
  ports: PortOption[];
  factories: FactoryOption[];
}

function itemKey(it: MissingItem): string {
  return `${it.origin_raw ?? ''}|${it.destination_raw ?? ''}|${it.ship_mode_raw}|${it.calc_status}`;
}

function shipModeOf(raw: string): 'Sea' | 'Air' | 'Land' | null {
  const v = raw.toUpperCase();
  if (v === 'SEA') return 'Sea';
  if (v === 'AIR') return 'Air';
  if (v === 'TRUCK' || v === 'CAR') return 'Land';
  return null; // COURIER 判斷不出來，這種列本來就沒有明確 ship_mode，需在表單裡讓使用者選
}

export default function TransportReviewClient({ initialItems, ports, factories }: Props) {
  const [items, setItems] = useState<MissingItem[]>(initialItems);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string>('');

  // 表單狀態（每次展開一列時重置）
  const [originStd, setOriginStd] = useState('');
  const [shipModeChoice, setShipModeChoice] = useState<'Sea' | 'Air' | 'Land'>('Land');
  const [destStd, setDestStd] = useState('');
  const [destFactoryId, setDestFactoryId] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [note, setNote] = useState('');

  function openItem(it: MissingItem) {
    const key = itemKey(it);
    setExpandedKey(expandedKey === key ? null : key);
    setMsg('');
    setOriginStd(it.origin_raw ?? '');
    const guessedMode = shipModeOf(it.ship_mode_raw);
    setShipModeChoice(guessedMode ?? 'Land');
    setDestStd(guessedMode === 'Land' ? '' : (it.destination_raw ?? ''));
    setDestFactoryId(it.factory_ids[0] ?? '');
    setDistanceKm('');
    setNote('');
  }

  async function submit(it: MissingItem) {
    if (!originStd.trim() || !distanceKm) { setMsg('❌ 請填起點標準名稱與距離公里數'); return; }
    const destination_type = shipModeChoice === 'Land' ? 'factory' : 'port';
    if (destination_type === 'port' && !destStd.trim()) { setMsg('❌ 請填迄點港口標準名稱'); return; }
    if (destination_type === 'factory' && !destFactoryId) { setMsg('❌ 請選工廠'); return; }

    setSaving(true);
    setMsg('');
    try {
      const res = await fetch('/api/transport/review/resolve-distance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin_raw: it.origin_raw,
          destination_raw: it.destination_raw,
          ship_mode_raw: it.ship_mode_raw,
          ship_mode: shipModeChoice,
          origin_standard_name: originStd.trim(),
          destination_type,
          destination_standard_port_name: destination_type === 'port' ? destStd.trim() : undefined,
          destination_factory_id: destination_type === 'factory' ? destFactoryId : undefined,
          distance_km: Number(distanceKm),
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(`❌ ${data.error}`); return; }
      setMsg(`✅ 已建立路線，重算 ${data.data.recalculated} 筆 PO，解決 ${data.data.resolvedFlagCount} 筆異常提醒`);
      setItems((prev) => prev.filter((x) => itemKey(x) !== itemKey(it)));
      setExpandedKey(null);
    } catch {
      setMsg('❌ 發生錯誤，請重試');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div style={{ backgroundColor: HEADER_BG }} className="text-white px-6 py-4">
        <div className="max-w-[1400px] mx-auto">
          <a href="/" className="text-green-300 text-xs hover:underline">← 返回首頁</a>
          <h1 className="text-xl font-bold mt-0.5">資料覆核中心｜上游運輸缺距離待補</h1>
          <p className="text-xs text-green-200 mt-0.5">
            共 {items.length} 組路線待補值 · 補值後立即重算所有卡住的 PO 明細
          </p>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 py-6">
        {items.length === 0 && (
          <div className="text-center text-gray-400 py-16 text-sm">目前沒有缺距離的路線，都補齊了。</div>
        )}

        <div className="space-y-3">
          {items.map((it) => {
            const key = itemKey(it);
            const expanded = expandedKey === key;
            return (
              <div key={key} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <button
                  onClick={() => openItem(it)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                      {it.calc_status === 'pending_review' ? '待複查' : '缺距離'}
                    </span>
                    <span className="font-medium text-sm">
                      {it.origin_raw ?? '（起點未知）'} → {it.destination_raw ?? '（迄點未知）'}
                    </span>
                    <span className="text-xs text-gray-500">{it.ship_mode_raw}</span>
                    <span className="text-xs text-gray-400">工廠：{it.factory_names.join('、')}</span>
                  </div>
                  <span className="text-sm font-semibold" style={{ color: HEADER_BG }}>
                    影響 {it.affected_count} 筆
                  </span>
                </button>

                {expanded && (
                  <div className="px-4 pb-4 border-t border-gray-100 pt-3 bg-gray-50/50">
                    {it.sample_raw_address && (
                      <p className="text-xs text-gray-500 mb-2">原始地址範例：{it.sample_raw_address}</p>
                    )}
                    {it.sample_vendor_name && (
                      <p className="text-xs text-gray-500 mb-3">供應商範例：{it.sample_vendor_name}</p>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">運輸方式</label>
                        <select value={shipModeChoice} onChange={(e) => setShipModeChoice(e.target.value as 'Sea' | 'Air' | 'Land')}
                          className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm">
                          <option value="Land">陸運 Land</option>
                          <option value="Sea">海運 Sea</option>
                          <option value="Air">空運 Air</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">
                          {shipModeChoice === 'Land' ? '起點（供應商，不需要標準化）' : '起點標準名稱'}
                        </label>
                        {shipModeChoice === 'Land' ? (
                          <input value={originStd} onChange={(e) => setOriginStd(e.target.value)}
                            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm" placeholder="供應商名稱（自動帶入，通常不用改）" />
                        ) : (
                          <input list="port-options" value={originStd} onChange={(e) => setOriginStd(e.target.value)}
                            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm" placeholder="例如 Ho Chi Minh City" />
                        )}
                      </div>

                      {shipModeChoice === 'Land' ? (
                        <div>
                          <label className="block text-[10px] text-gray-500 mb-1">迄點工廠</label>
                          <select value={destFactoryId} onChange={(e) => setDestFactoryId(e.target.value)}
                            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm">
                            <option value="">請選擇</option>
                            {factories.map((f) => (
                              <option key={f.id} value={f.id}>{f.factory_code} {f.name_zh}</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div>
                          <label className="block text-[10px] text-gray-500 mb-1">迄點港口標準名稱</label>
                          <input list="port-options" value={destStd} onChange={(e) => setDestStd(e.target.value)}
                            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm" placeholder="例如 Semarang" />
                        </div>
                      )}

                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">距離（公里）</label>
                        <input type="number" min="0" step="0.01" value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)}
                          className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm" />
                      </div>
                    </div>

                    <div className="mt-3">
                      <label className="block text-[10px] text-gray-500 mb-1">備註（選填，例如佐證來源說明）</label>
                      <input value={note} onChange={(e) => setNote(e.target.value)}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm" />
                    </div>

                    <div className="mt-3 flex items-center gap-3">
                      <a
                        href={`https://www.google.com/maps/search/${encodeURIComponent(originStd || it.origin_raw || '')}`}
                        target="_blank" rel="noreferrer"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        開 Google 地圖查距離 ↗
                      </a>
                      <button onClick={() => submit(it)} disabled={saving}
                        className="ml-auto px-4 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                        style={{ backgroundColor: HEADER_BG }}>
                        {saving ? '送出中…' : '送出並補值'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {msg && <p className="text-sm mt-4">{msg}</p>}

        <datalist id="port-options">
          {ports.map((p) => <option key={p.id} value={p.standard_name} />)}
        </datalist>
      </div>
    </div>
  );
}
