'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { api, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useAccess } from '@/stores/access';
import { toInputDate } from '@/lib/format';
import type { ScheduleItem } from '@/lib/types';
import { SCurvePanel } from '@/components/SCurvePanel';

interface Row {
  code: string;
  name: string;
  planStart: string;
  planFinish: string;
  delayDays: string;
  percentDone: string;
  weekGrowth: string;
}

const cell =
  'w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none transition hover:border-gray-200 focus:border-[#00823C] focus:bg-white focus:ring-2 focus:ring-[#00823C]/20';

function level(code: string) {
  return code.split('.').filter(Boolean).length;
}

export function ScheduleTab({ projectId }: { projectId: string }) {
  const token = useAuth((s) => s.token);
  const canEditSchedule = useAccess((s) => s.canEdit('schedule', projectId));

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [asOfDate, setAsOfDate] = useState<string | null>(null);
  const [automationConfigured, setAutomationConfigured] = useState(false);
  const [source, setSource] = useState<'manual' | 'planr'>('manual');
  const [reportMode, setReportMode] = useState<'manual' | 's_curve'>('manual');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ items: ScheduleItem[]; source: 'manual' | 'planr'; reportMode: 'manual' | 's_curve'; automationConfigured: boolean; asOfDate: string | null }>(`/projects/${projectId}/schedule`, { token });
      setAsOfDate(res.asOfDate);
      setAutomationConfigured(res.automationConfigured);
      setSource(res.source);
      setReportMode(res.reportMode);
      setRows(
        res.items.map((i) => ({
          code: i.code,
          name: i.name,
          planStart: toInputDate(i.planStart),
          planFinish: toInputDate(i.planFinish),
          delayDays: i.delayDays != null ? String(i.delayDays) : '',
          percentDone: i.percentDone != null ? String(i.percentDone) : '',
          weekGrowth: i.weekGrowth != null ? String(i.weekGrowth) : '',
        })),
      );
    } catch (err) {
      setError(errText(err, 'Не удалось загрузить график работ'));
    } finally {
      setLoading(false);
    }
  }, [projectId, token]);

  useEffect(() => { load(); }, [load]);

  function upd(i: number, patch: Partial<Row>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function addRow(afterIdx?: number) {
    const blank: Row = {
      code: '', name: '', planStart: '', planFinish: '',
      delayDays: '', percentDone: '', weekGrowth: '',
    };
    setRows((r) => {
      if (afterIdx === undefined) return [...r, blank];
      const next = [...r];
      next.splice(afterIdx + 1, 0, blank);
      return next;
    });
    setEdit(true);
  }

  async function save() {
    const bad = rows.findIndex((r) => !r.code.trim() || !r.name.trim());
    if (bad >= 0) {
      setError(`Строка ${bad + 1}: заполните «№» и «Наименование работ»`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ data: ScheduleItem[]; warnings: string[] }>(
        `/projects/${projectId}/schedule`,
        {
          method: 'PUT',
          token,
          body: JSON.stringify({
            items: rows.map((r) => ({
              code: r.code.trim(),
              name: r.name.trim(),
              planStart: r.planStart || null,
              planFinish: r.planFinish || null,
              delayDays: r.delayDays === '' ? null : Math.round(Number(r.delayDays)),
              percentDone: r.percentDone === '' ? null : Number(r.percentDone),
              weekGrowth: r.weekGrowth === '' ? null : Number(r.weekGrowth),
            })),
          }),
        },
      );
      setWarnings(res.warnings ?? []);
      setSavedAt(new Date().toLocaleTimeString('ru-RU'));
      setEdit(false);
      load();
    } catch (err) {
      setError(errText(err, 'Не удалось сохранить график работ'));
    } finally {
      setSaving(false);
    }
  }

  async function refresh() {
    setSaving(true); setError(null);
    try {
      await api(`/projects/${projectId}/schedule/refresh`, { method: 'POST', token });
      setSavedAt(new Date().toLocaleTimeString('ru-RU'));
      await load();
    } catch (refreshError) {
      setError(errText(refreshError, 'Не удалось актуализировать график из PLAN-R'));
    } finally { setSaving(false); }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загрузка…
      </div>
    );
  }

  if (reportMode === 's_curve') {
    return <SCurvePanel projectId={projectId} canRefresh={canEditSchedule} />;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold text-[#28282D]">График работ за отчётный период</h3>
          <p className="text-xs text-gray-400">
            {automationConfigured ? `Источник: PLAN-R${source === 'planr' ? ' · показан последний успешный снимок' : ''}` : 'Ручной ввод · PLAN-R пока не настроен'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedAt && !edit && <span className="text-xs text-[#00823C]">Сохранено в {savedAt}</span>}
          {canEditSchedule && (
            automationConfigured ? (
              <button onClick={refresh} disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-[#00823C] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                <RefreshCw className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} /> Актуализировать
              </button>
            ) : <>
              <button onClick={() => addRow()}
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-[#28282D] transition hover:border-[#00823C] hover:text-[#00823C]">
                <Plus className="h-4 w-4" /> Добавить строку
              </button>
              <button onClick={save} disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-[#00823C] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#006e33] disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Сохранить
              </button>
            </>
          )}
        </div>
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

      {rows.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white py-16 text-center text-gray-400">
          {canEditSchedule && !automationConfigured
            ? 'График пуст. Нажмите «Добавить строку» — нумерация задаёт иерархию: 1.1 → 1.1.1 → 1.1.7.1'
            : 'График пока не заполнен.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full min-w-[1050px] text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="w-24 px-3 py-3">№</th>
                <th className="px-3 py-3">Наименование работ</th>
                <th className="w-36 px-3 py-3">Начало</th>
                <th className="w-36 px-3 py-3">Завершение</th>
                <th className="w-28 px-3 py-3">Отставание, дни</th>
                <th className="w-32 px-3 py-3">Выполнение{asOfDate ? ` на ${new Date(asOfDate).toLocaleDateString('ru-RU')}` : ''}, %</th>
                <th className="w-28 px-3 py-3">Прирост за неделю, %</th>
                {canEditSchedule && !automationConfigured && <th className="w-10 px-3 py-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r, i) => {
                const lv = level(r.code);
                const isGroup = lv <= 2;
                const d = r.delayDays === '' ? null : Number(r.delayDays);

                return (
                  <tr key={i} className={isGroup ? 'bg-[#EEE3DF]' : 'hover:bg-gray-50/40'}>
                    <td className="px-3 py-1.5">
                      <input value={r.code} disabled={!canEditSchedule || automationConfigured} onChange={(e) => upd(i, { code: e.target.value })}
                        placeholder="1.1.1"
                        className={`${cell} font-mono text-xs ${isGroup ? 'font-bold' : ''}`} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input value={r.name} disabled={!canEditSchedule || automationConfigured} onChange={(e) => upd(i, { name: e.target.value })}
                        placeholder="Устройство фундаментов"
                        style={{ paddingLeft: `${(lv - 1) * 16 + 8}px` }}
                        className={`${cell} ${isGroup ? 'font-bold text-[#28282D]' : 'text-gray-700'}`} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="date" value={r.planStart} disabled={!canEditSchedule || automationConfigured}
                        onChange={(e) => upd(i, { planStart: e.target.value })} className={cell} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="date" value={r.planFinish} disabled={!canEditSchedule || automationConfigured}
                        onChange={(e) => upd(i, { planFinish: e.target.value })} className={cell} />
                    </td>
                    <td className="px-3 py-1.5">
                        <input type="number" value={r.delayDays} placeholder="—" disabled={!canEditSchedule || automationConfigured}
                          onChange={(e) => upd(i, { delayDays: e.target.value })}
                          className={`${cell} ${
                            d != null && d > 0 ? 'font-medium text-red-600'
                            : d != null && d < 0 ? 'font-medium text-[#45A735]'
                            : ''
                          }`} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="number" min={0} max={100} value={r.percentDone} placeholder="—" disabled={!canEditSchedule || automationConfigured}
                        onChange={(e) => upd(i, { percentDone: e.target.value })} className={cell} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input type="number" value={r.weekGrowth} placeholder="—" disabled={!canEditSchedule || automationConfigured}
                        onChange={(e) => upd(i, { weekGrowth: e.target.value })} className={cell} />
                    </td>
                    {canEditSchedule && !automationConfigured && <td className="px-3 py-1.5">
                        <button onClick={() => setRows((rr) => rr.filter((_, idx) => idx !== i))}
                          title="Удалить строку"
                          className="rounded-lg p-1 text-gray-300 transition hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                    </td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <p className="mt-2 text-xs text-gray-400">
          Иерархия задаётся номером: <b>1.1</b> и <b>1.2</b> — блоки (выделены серым),
          <b> 1.1.1</b> и глубже — работы. Отставание со знаком: <b>+55</b> — отстаём, <b>−10</b> — опережаем.
        </p>
      )}
    </div>
  );
}
