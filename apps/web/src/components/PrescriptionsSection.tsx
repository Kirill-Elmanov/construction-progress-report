'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Save } from 'lucide-react';
import { api, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import type { Prescriptions } from '@/lib/types';
import { DeltaBadge } from '@/components/DeltaBadge';

const box =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-[#00823C] focus:ring-2 focus:ring-[#00823C]/20 disabled:bg-gray-50 disabled:text-gray-400';

export function PrescriptionsSection({ reportId, readOnly }: { reportId: string; readOnly: boolean }) {
  const token = useAuth((s) => s.token);

  const [issued, setIssued] = useState('0');
  const [resolved, setResolved] = useState('0');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [deltas, setDeltas] = useState({ issued: 0, resolved: 0, open: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api<Prescriptions>(`/reports/${reportId}/prescriptions`, { token });
      setIssued(String(d.issuedTotal));
      setResolved(String(d.resolvedTotal));
      setDeltas(d.deltas ?? { issued: 0, resolved: 0, open: 0 });
    } catch (err) {
      setError(errText(err, 'Не удалось загрузить предписания'));
    } finally {
      setLoading(false);
    }
  }, [reportId, token]);

  useEffect(() => { load(); }, [load]);

  const iNum = Number(issued || 0);
  const rNum = Number(resolved || 0);
  const open = iNum - rNum;
  const invalid = rNum > iNum;

  async function save() {
    if (invalid) {
      setError('Устранено не может быть больше, чем выдано (Е2 ≤ Е1)');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ data: Prescriptions; warnings: string[] }>(
        `/reports/${reportId}/prescriptions`,
        {
          method: 'PUT',
          token,
          body: JSON.stringify({ issuedTotal: iNum, resolvedTotal: rNum }),
        },
      );
      setWarnings(res.warnings ?? []);
      setDeltas(res.data.deltas ?? { issued: 0, resolved: 0, open: 0 });
      setSavedAt(new Date().toLocaleTimeString('ru-RU'));
    } catch (err) {
      setError(errText(err, 'Не удалось сохранить предписания'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-gray-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загрузка секции Д…
      </div>
    );
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-[#28282D]">Секция Е — Предписания</h2>
        {!readOnly && (
          <div className="flex items-center gap-2">
            {savedAt && <span className="text-xs text-[#00823C]">Сохранено в {savedAt}</span>}
            <button onClick={save} disabled={saving || invalid}
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

      <div className="grid grid-cols-1 gap-4 rounded-2xl border border-gray-200 bg-white p-5 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-[#28282D]">Е1 · Выдано всего</label>
          <input type="number" min={0} value={issued} disabled={readOnly}
            onChange={(e) => setIssued(e.target.value)} className={box} />
          <div className="mt-1"><DeltaBadge value={deltas.issued} suffix=" новых предписаний" /></div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[#28282D]">Е2 · Устранено всего</label>
          <input type="number" min={0} value={resolved} disabled={readOnly}
            onChange={(e) => setResolved(e.target.value)}
            className={`${box} ${invalid ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''}`} />
          {invalid
            ? <p className="mt-1 text-xs text-red-600">Е2 не может быть больше Е1</p>
            : <div className="mt-1"><DeltaBadge value={deltas.resolved} suffix=" закрытых предписаний" /></div>}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[#28282D]">
            Открытых <span className="text-xs font-normal text-gray-400">(расчёт)</span>
          </label>
          <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${
            open > 0 ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-[#00823C]'
          }`}>
            {open < 0 ? '—' : open}
          </div>
          <div className="mt-1"><DeltaBadge value={deltas.open} /></div>
        </div>
      </div>
    </section>
  );
}
