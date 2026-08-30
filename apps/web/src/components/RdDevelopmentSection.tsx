'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Save } from 'lucide-react';
import { api, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { DeltaBadge } from '@/components/DeltaBadge';
import type { RdDevelopment } from '@/lib/types';

const box =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-[#00823C] focus:ring-2 focus:ring-[#00823C]/20 disabled:bg-gray-50 disabled:text-gray-400';

type Key = 'volumesTotal' | 'handedToCustomer' | 'onReview' | 'issuedVpr' | 'inProgress' | 'withRemarks';

const FIELDS: { key: Key; label: string; accent?: boolean }[] = [
  { key: 'volumesTotal', label: 'В1 · Всего томов', accent: true },
  { key: 'handedToCustomer', label: 'В2 · Передано Тех. Заказчику' },
  { key: 'onReview', label: 'В3 · На проверке' },
  { key: 'issuedVpr', label: 'В4 · Выдано ВПР' },
  { key: 'inProgress', label: 'В5 · В разработке' },
  { key: 'withRemarks', label: 'В6 · Выданы замечания' },
];

export function RdDevelopmentSection({ reportId, readOnly }: { reportId: string; readOnly: boolean }) {
  const token = useAuth((s) => s.token);

  const [vals, setVals] = useState<Record<Key, string>>({
    volumesTotal: '0', handedToCustomer: '0', onReview: '0',
    issuedVpr: '0', inProgress: '0', withRemarks: '0',
  });
  const [deltas, setDeltas] = useState({ volumesTotal: 0, handedToCustomer: 0, issuedVpr: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [automationConfigured, setAutomationConfigured] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api<RdDevelopment>(`/reports/${reportId}/rd-development`, { token });
      setVals({
        volumesTotal: String(d.volumesTotal),
        handedToCustomer: String(d.handedToCustomer),
        onReview: String(d.onReview),
        issuedVpr: String(d.issuedVpr),
        inProgress: String(d.inProgress),
        withRemarks: String(d.withRemarks),
      });
      setDeltas(d.deltas);
      setAutomationConfigured(Boolean(d.automationConfigured));
    } catch (err) {
      setError(errText(err, 'Не удалось загрузить раздел «Разработка РД»'));
    } finally {
      setLoading(false);
    }
  }, [reportId, token]);

  useEffect(() => { load(); }, [load]);

  const n = (k: Key) => Math.round(Number(vals[k] || 0));
  const totalVolumes = n('volumesTotal');
  const donePercent = totalVolumes > 0
    ? Math.round((n('handedToCustomer') / totalVolumes) * 1000) / 10
    : 0;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ data: RdDevelopment; warnings: string[] }>(
        `/reports/${reportId}/rd-development`,
        {
          method: 'PUT', token,
          body: JSON.stringify({
            volumesTotal: n('volumesTotal'),
            handedToCustomer: n('handedToCustomer'),
            onReview: n('onReview'),
            issuedVpr: n('issuedVpr'),
            inProgress: n('inProgress'),
            withRemarks: n('withRemarks'),
          }),
        },
      );
      setWarnings(res.warnings ?? []);
      setDeltas(res.data.deltas);
      setSavedAt(new Date().toLocaleTimeString('ru-RU'));
    } catch (err) {
      setError(errText(err, 'Не удалось сохранить раздел'));
    } finally {
      setSaving(false);
    }
  }

  async function refresh() {
    setSaving(true); setError(null);
    try {
      const res = await api<{ data: RdDevelopment; warnings: string[]; syncedAt: string }>(
        `/reports/${reportId}/rd-development/refresh`, { method: 'POST', token },
      );
      const d = res.data;
      setVals({
        volumesTotal: String(d.volumesTotal), handedToCustomer: String(d.handedToCustomer),
        onReview: String(d.onReview), issuedVpr: String(d.issuedVpr),
        inProgress: String(d.inProgress), withRemarks: String(d.withRemarks),
      });
      setDeltas(d.deltas); setWarnings(res.warnings ?? []);
      setSavedAt(new Date(res.syncedAt).toLocaleTimeString('ru-RU'));
    } catch (refreshError) {
      setError(errText(refreshError, 'Не удалось актуализировать данные из Google-таблицы'));
    } finally { setSaving(false); }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-gray-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загрузка секции В…
      </div>
    );
  }

  const deltaFor = (k: Key) =>
    k === 'volumesTotal' ? deltas.volumesTotal
    : k === 'handedToCustomer' ? deltas.handedToCustomer
    : k === 'issuedVpr' ? deltas.issuedVpr
    : null;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-[#28282D]">Секция В — Разработка РД</h2>
          <p className="text-xs text-gray-400">
            {automationConfigured ? 'Источник: Google-таблица «Реестр РД»' : 'Ручной ввод · источник Google пока не настроен'}
          </p>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            {savedAt && <span className="text-xs text-[#00823C]">Сохранено в {savedAt}</span>}
            {automationConfigured && (
              <button onClick={refresh} disabled={saving}
                className="flex items-center gap-1.5 rounded-lg border border-[#00823C] px-3 py-1.5 text-sm font-medium text-[#00823C] disabled:opacity-60">
                <RefreshCw className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} /> Актуализировать
              </button>
            )}
            <button onClick={save} disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-[#00823C] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#006e33] disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Сохранить секцию
            </button>
          </div>
        )}
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {warnings.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="mb-1 flex items-center gap-2 text-sm font-medium text-amber-800">
            <AlertTriangle className="h-4 w-4" /> Предупреждения ({warnings.length})
          </p>
          <ul className="ml-6 list-disc space-y-0.5 text-sm text-amber-700">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {FIELDS.map((f) => {
            const d = deltaFor(f.key);
            return (
              <div key={f.key} className={f.accent ? 'rounded-xl bg-[#00823C]/5 p-3' : 'rounded-xl bg-gray-50 p-3'}>
                <label className="mb-1 block text-xs font-medium text-[#28282D]">{f.label}</label>
                <input type="number" min={0} value={vals[f.key]} disabled={readOnly}
                  onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                  className={box} />
                {d !== null && <div className="mt-1"><DeltaBadge value={d} /></div>}
              </div>
            );
          })}
        </div>

        {totalVolumes > 0 && (
          <div className="rounded-xl bg-gray-50 p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm text-gray-500">Передано Тех. Заказчику <span className="text-xs">(расчёт)</span></span>
              <span className="text-sm text-gray-500">{n('handedToCustomer')} из {totalVolumes} томов</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-gray-200">
              <div className="h-full rounded-full bg-[#00823C] transition-all"
                style={{ width: `${Math.min(donePercent, 100)}%` }} />
            </div>
            <p className="mt-1.5 text-lg font-bold text-[#00823C]">{donePercent}%</p>
          </div>
        )}
      </div>
    </section>
  );
}
