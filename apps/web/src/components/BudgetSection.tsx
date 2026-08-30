'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { api, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { fmtMoney, maskNumberInput, unmaskNumber } from '@/lib/format';
import { DeltaBadge } from '@/components/DeltaBadge';
import type { BudgetOptionalField, BudgetWeekly } from '@/lib/types';

const box =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-[#00823C] focus:ring-2 focus:ring-[#00823C]/20 disabled:bg-gray-50 disabled:text-gray-400';

export function BudgetSection({ reportId, readOnly }: { reportId: string; readOnly: boolean }) {
  const token = useAuth((s) => s.token);

  const [paid, setPaid] = useState('0');
  const [optionalFields, setOptionalFields] = useState<BudgetOptionalField[]>([]);
  const [projectBudget, setProjectBudget] = useState(0);
  const [deltas, setDeltas] = useState({ paidGp: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api<BudgetWeekly>(`/reports/${reportId}/budget`, { token });
      setPaid(maskNumberInput(String(d.paidGp)));
      setOptionalFields((d.optionalFields ?? []).map((field) => ({
        ...field,
        value: field.value === null ? null : Number(field.value),
      })));
      setProjectBudget(d.projectBudget);
      setDeltas(d.deltas);
    } catch (err) {
      setError(errText(err, 'Не удалось загрузить бюджет'));
    } finally {
      setLoading(false);
    }
  }, [reportId, token]);

  useEffect(() => { load(); }, [load]);

  const paidNum = Math.round(unmaskNumber(paid) ?? 0);
  const percent = projectBudget > 0 ? Math.round((paidNum / projectBudget) * 1000) / 10 : 0;
  const over = projectBudget > 0 && paidNum > projectBudget;

  function addOptionalField() {
    setOptionalFields((rows) => [
      ...rows,
      { id: crypto.randomUUID(), label: '', value: null },
    ]);
  }

  function patchOptionalField(id: string, patch: Partial<BudgetOptionalField>) {
    setOptionalFields((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  async function save() {
    if (over) { setError('Оплачено ГП больше бюджета проекта (A7)'); return; }
    if (optionalFields.some((field) => field.value !== null && !field.label.trim())) {
      setError('Укажите название дополнительного показателя с заполненной суммой');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ data: BudgetWeekly; warnings: string[] }>(
        `/reports/${reportId}/budget`,
        {
          method: 'PUT', token,
          body: JSON.stringify({
            paidGp: paidNum,
            optionalFields,
          }),
        },
      );
      setWarnings(res.warnings ?? []);
      setDeltas(res.data.deltas);
      setSavedAt(new Date().toLocaleTimeString('ru-RU'));
    } catch (err) {
      setError(errText(err, 'Не удалось сохранить бюджет'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-gray-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загрузка секции Б…
      </div>
    );
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-[#28282D]">Секция Б — Бюджет</h2>
        {!readOnly && (
          <div className="flex items-center gap-2">
            {savedAt && <span className="text-xs text-[#00823C]">Сохранено в {savedAt}</span>}
            <button onClick={save} disabled={saving || over}
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-[#28282D]">
              Б1 · Оплачено ГП, ₽ <span className="text-red-500">*</span>
            </label>
            <input required inputMode="numeric" value={paid} disabled={readOnly}
              onChange={(e) => setPaid(maskNumberInput(e.target.value))} className={box} />
            <div className="mt-1"><DeltaBadge value={deltas.paidGp} format={(v) => fmtMoney(v)} /></div>
          </div>
        </div>

        {optionalFields.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-[#28282D]">Дополнительные показатели</p>
            {optionalFields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-1 gap-2 rounded-xl bg-gray-50 p-3 sm:grid-cols-[1fr_220px_auto] sm:items-end">
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Б{index + 2} · Название показателя</label>
                  <input value={field.label} disabled={readOnly} maxLength={120}
                    onChange={(event) => patchOptionalField(field.id, { label: event.target.value })}
                    placeholder="Например, Принято работ" className={box} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Сумма, ₽</label>
                  <input inputMode="numeric" disabled={readOnly}
                    value={field.value === null ? '' : maskNumberInput(String(field.value))}
                    onChange={(event) => {
                      const raw = event.target.value;
                      patchOptionalField(field.id, {
                        value: raw.trim() === '' ? null : Math.round(unmaskNumber(raw) ?? 0),
                      });
                    }}
                    placeholder="необязательно" className={box} />
                </div>
                {!readOnly && (
                  <button type="button" title="Удалить показатель"
                    onClick={() => setOptionalFields((rows) => rows.filter((row) => row.id !== field.id))}
                    className="rounded-lg p-2 text-gray-400 transition hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {!readOnly && optionalFields.length < 10 && (
          <button type="button" onClick={addOptionalField}
            className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 transition hover:border-[#00823C] hover:text-[#00823C]">
            <Plus className="h-4 w-4" /> Добавить показатель
          </button>
        )}

        <div className={`rounded-xl p-4 ${over ? 'bg-red-50' : 'bg-gray-50'}`}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm text-gray-500">
              Освоение бюджета <span className="text-xs">(только Б1)</span>
            </span>
            <span className="text-sm text-gray-500">
              {fmtMoney(paidNum)} из {fmtMoney(projectBudget)}
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-gray-200">
            <div className={`h-full rounded-full transition-all ${
              percent > 100 ? 'bg-red-500' : percent > 90 ? 'bg-amber-500' : 'bg-[#00823C]'
            }`} style={{ width: `${Math.min(percent, 100)}%` }} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-3">
            <p className={`text-lg font-bold ${percent > 100 ? 'text-red-600' : 'text-[#00823C]'}`}>
              {percent}%
            </p>
            <DeltaBadge value={deltas.paidGp} format={(v) => fmtMoney(v)} />
          </div>
          {over && <p className="mt-1 text-xs text-red-600">Освоено больше бюджета проекта (A7)</p>}
        </div>
      </div>
    </section>
  );
}
