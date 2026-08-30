'use client';

import { useCallback, useEffect, useState } from 'react';
import { HardHat, Loader2, Save, Truck, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { api, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import type { ResourcesWeekly } from '@/lib/types';

const box =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-[#00823C] focus:ring-2 focus:ring-[#00823C]/20 disabled:bg-gray-50 disabled:text-gray-400';

function Delta({ value }: { value: number }) {
  if (value === 0) return <span className="text-xs text-gray-400">без изменений</span>;
  const up = value > 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${up ? 'text-[#00823C]' : 'text-red-600'}`}>
      {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {up ? '+' : ''}{value} за неделю
    </span>
  );
}

export function ResourcesSection({ reportId, readOnly }: { reportId: string; readOnly: boolean }) {
  const token = useAuth((s) => s.token);

  const [itr, setItr] = useState('0');
  const [workers, setWorkers] = useState('0');
  const [machinery, setMachinery] = useState('0');
  const [comment, setComment] = useState('');
  const [deltas, setDeltas] = useState({ itr: 0, workers: 0, machinery: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api<ResourcesWeekly>(`/reports/${reportId}/resources`, { token });
      setItr(String(d.itr));
      setWorkers(String(d.workers));
      setMachinery(String(d.machinery));
      setComment(d.comment ?? '');
      setDeltas(d.deltas);
    } catch (err) {
      setError(errText(err, 'Не удалось загрузить ресурсы'));
    } finally {
      setLoading(false);
    }
  }, [reportId, token]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ data: ResourcesWeekly; warnings: string[] }>(
        `/reports/${reportId}/resources`,
        {
          method: 'PUT',
          token,
          body: JSON.stringify({
            itr: Math.round(Number(itr || 0)),
            workers: Math.round(Number(workers || 0)),
            machinery: Math.round(Number(machinery || 0)),
            ...(comment.trim() ? { comment: comment.trim() } : {}),
          }),
        },
      );
      setDeltas(res.data.deltas);
      setSavedAt(new Date().toLocaleTimeString('ru-RU'));
    } catch (err) {
      setError(errText(err, 'Не удалось сохранить ресурсы'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-gray-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загрузка секции Ж…
      </div>
    );
  }

  const cards = [
    { icon: HardHat, label: 'Ж1 · ИТР', value: itr, set: setItr, max: 999, delta: deltas.itr },
    { icon: Users, label: 'Ж2 · Рабочие', value: workers, set: setWorkers, max: 9999, delta: deltas.workers },
    { icon: Truck, label: 'Ж3 · Техника', value: machinery, set: setMachinery, max: 999, delta: deltas.machinery },
  ];

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-[#28282D]">Секция Ж — Привлечённые ресурсы</h2>
        {!readOnly && (
          <div className="flex items-center gap-2">
            {savedAt && <span className="text-xs text-[#00823C]">Сохранено в {savedAt}</span>}
            <button onClick={save} disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-[#00823C] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#006e33] disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Сохранить секцию
            </button>
          </div>
        )}
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {cards.map((c) => (
            <div key={c.label} className="rounded-xl bg-gray-50 p-4">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-[#28282D]">
                <c.icon className="h-4 w-4 text-gray-400" /> {c.label}
              </p>
              <input type="number" min={0} max={c.max} value={c.value} disabled={readOnly}
                onChange={(e) => c.set(e.target.value)} className={box} />
              <div className="mt-1.5"><Delta value={c.delta} /></div>
            </div>
          ))}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[#28282D]">Ж4 · Комментарий</label>
          <input value={comment} disabled={readOnly} maxLength={300}
            onChange={(e) => setComment(e.target.value)}
            placeholder="необязательно" className={box} />
        </div>
      </div>
    </section>
  );
}
