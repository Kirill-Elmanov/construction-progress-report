'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { fmtDate, toInputDate } from '@/lib/format';
import { dateDeviation } from '@/lib/types';
import type { Contractor, Section } from '@/lib/types';
import { DeviationBadge } from '@/components/DeviationBadge';
import { useConfirm } from '@/components/ConfirmDialog';
import { useAccess } from '@/stores/access';

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-[#28282D] outline-none transition focus:border-[#00823C] focus:ring-2 focus:ring-[#00823C]/20';

export function SectionsTab({ projectId }: { projectId: string }) {
  const token = useAuth((s) => s.token);
  const confirm = useConfirm();
  const canEdit = useAccess((s) => s.canEdit('worklog', projectId));

  const [sections, setSections] = useState<Section[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Section | null>(null);
  const [creating, setCreating] = useState(false);
  

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, c] = await Promise.all([
        api<Section[]>(`/projects/${projectId}/sections`, { token }),
        api<Contractor[]>(`/projects/${projectId}/contractors`, { token }),
      ]);
      setSections(s);
      setContractors(c);
    } catch (err) {
      setError(errText(err, 'Не удалось загрузить разделы'));
    } finally {
      setLoading(false);
    }
  }, [projectId, token]);

  useEffect(() => { load(); }, [load]);

  async function remove(s: Section) {
    const ok = await confirm({
      message: `Удалить раздел «${s.name}»?`,
      description: 'Раздел и связанные с ним данные будут удалены безвозвратно.',
      confirmText: 'Удалить',
    });
    if (!ok) return;
    try {
      await api(`/sections/${s.id}`, { method: 'DELETE', token });
      load();
    } catch (err) {
      alert(errText(err, 'Не удалось удалить раздел'));
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= sections.length) return;
    const arr = [...sections];
    [arr[index], arr[next]] = [arr[next], arr[index]];
    setSections(arr); // оптимистично
    try {
      await api(`/projects/${projectId}/sections/reorder`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ order: arr.map((s) => s.id) }),
      });
    } catch (err) {
      alert(errText(err, 'Не удалось изменить порядок'));
      load();
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загрузка…
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-[#28282D]">Выполняемые работы за отчётный период</h3>
        {canEdit && <button onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-lg bg-[#00823C] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#006e33]">
          <Plus className="h-4 w-4" /> Добавить раздел
        </button>}
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {sections.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white py-16 text-center text-gray-400">
          Разделов пока нет. Добавьте первый — без них нельзя вести отчёты.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="w-16 px-4 py-3">№</th>
                <th className="px-4 py-3">Название</th>
                <th className="px-4 py-3">Шифр комплекта РД</th>
                <th className="px-4 py-3">Подрядчик</th>
                <th className="w-24 px-4 py-3">Готовность</th>
                <th className="px-4 py-3">План<br /><span className="normal-case text-[10px] text-gray-400">начало / окончание</span></th>
                <th className="px-4 py-3">Факт<br /><span className="normal-case text-[10px] text-gray-400">начало / окончание</span></th>
                <th className="w-28 px-4 py-3">Δ начала</th>
                <th className="w-28 px-4 py-3">Δ оконч.</th>
                <th className="w-24 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sections.map((s, i) => (
                <tr key={s.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-4 text-gray-400">{i + 1}</span>
                      {canEdit && <div className="flex flex-col gap-0.5">
                        <button type="button" title="Поднять выше"
                          onClick={() => move(i, -1)} disabled={i === 0}
                          className="rounded border border-gray-200 bg-gray-50 p-0.5 text-gray-600 transition hover:border-[#00823C] hover:bg-[#00823C] hover:text-white disabled:opacity-25 disabled:hover:border-gray-200 disabled:hover:bg-gray-50 disabled:hover:text-gray-600">
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" title="Опустить ниже"
                          onClick={() => move(i, 1)} disabled={i === sections.length - 1}
                          className="rounded border border-gray-200 bg-gray-50 p-0.5 text-gray-600 transition hover:border-[#00823C] hover:bg-[#00823C] hover:text-white disabled:opacity-25 disabled:hover:border-gray-200 disabled:hover:bg-gray-50 disabled:hover:text-gray-600">
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium text-[#28282D]">{s.name}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">
                    {s.code || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{s.contractor?.name ?? '—'}</td>
                  <td className="px-4 py-3 font-semibold text-[#00823C]">{s.percentDone ?? 0}%</td>

                  {/* ПР-4.2: план в две строки */}
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                    <p>{fmtDate(s.planStart)}</p>
                    <p>{fmtDate(s.planFinish)}</p>
                  </td>

                  {/* ПР-4.1: факт; окончание — «---» пока не 100% */}
                  <td className="whitespace-nowrap px-4 py-3 text-xs">
                    <p className={s.factStart ? 'font-medium text-[#28282D]' : 'text-gray-300'}>
                      {s.factStart ? fmtDate(s.factStart) : '- - -'}
                    </p>
                    <p className={s.factFinish ? 'font-medium text-[#28282D]' : 'text-gray-300'}>
                      {s.factFinish ? fmtDate(s.factFinish) : '- - -'}
                    </p>
                  </td>

                  <td className="px-4 py-3">
                    <DeviationBadge {...dateDeviation(s.planStart, s.factStart)} />
                  </td>
                  <td className="px-4 py-3">
                    <DeviationBadge {...dateDeviation(s.planFinish, s.factFinish)} />
                  </td>
                  <td className="px-4 py-3">
                    {canEdit && <div className="flex justify-end gap-1">
                      <button onClick={() => setEditing(s)}
                        className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-[#00823C]">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => remove(s)}
                        className="rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sections.length > 0 && (
        <p className="mt-2 text-xs text-gray-400">
          🚦 Светофор: 🟢 менее 7 дней · 🟡 7–13 дней · 🔴 14 дней и более.
          Знак <b>*</b> — факт ещё не внесён, показана текущая просрочка от плана.
        </p>
      )}

      {(creating || editing) && (
        <SectionModal
          projectId={projectId}
          contractors={contractors}
          section={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function SectionModal({
  projectId, contractors, section, onClose, onSaved,
}: {
  projectId: string;
  contractors: Contractor[];
  section: Section | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const token = useAuth((s) => s.token);
  const [name, setName] = useState(section?.name ?? '');
  const [code, setCode] = useState(section?.code ?? '');
  const [contractorId, setContractorId] = useState(section?.contractorId ?? '');
  const [planStart, setPlanStart] = useState(toInputDate(section?.planStart));
  const [planFinish, setPlanFinish] = useState(toInputDate(section?.planFinish));
  const [factStart, setFactStart] = useState(toInputDate(section?.factStart));
  const [factFinish, setFactFinish] = useState(toInputDate(section?.factFinish));
  const [percentDone, setPercentDone] = useState(String(section?.percentDone ?? 0));

  // Правки v3: процент вводится вручную и сразу управляет фактическим окончанием.
  const percent = Number(percentDone || 0);
  const finishLocked = percent < 100;
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      // contractorId шлём ТОЛЬКО если выбран (бэк ждёт uuid, пустая строка = 400)
      const body: Record<string, unknown> = {
        name: name.trim(),
        planStart,
        planFinish,
      };
      if (code.trim()) body.code = code.trim();
      if (contractorId) body.contractorId = contractorId;
      body.factStart = factStart || null;
      body.factFinish = percent >= 100 ? factFinish || null : null;
      body.percentDone = percent;

      if (section) {
        await api(`/sections/${section.id}`, { method: 'PATCH', token, body: JSON.stringify(body) });
      } else {
        await api(`/projects/${projectId}/sections`, { method: 'POST', token, body: JSON.stringify(body) });
      }
      onSaved();
    } catch (e2) {
      setErr(errText(e2, 'Не удалось сохранить раздел'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h3 className="text-lg font-bold text-[#28282D]">
            {section ? 'Редактировать раздел' : 'Новый раздел'}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 p-6">
          {err && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

          <div>
            <label className="mb-1 block text-sm font-medium text-[#28282D]">
              Название раздела <span className="text-red-500">*</span>
            </label>
            <input value={name} onChange={(e) => setName(e.target.value)} required
              placeholder="Монолитные работы" className={inputCls} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-[#28282D]">
              Шифр комплекта РД
            </label>
            <input value={code} onChange={(e) => setCode(e.target.value)}
              placeholder="24-2026/08-КМ" maxLength={60} className={inputCls} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-[#28282D]">Подрядчик</label>
            <select value={contractorId} onChange={(e) => setContractorId(e.target.value)} className={inputCls}>
              <option value="">— не назначен —</option>
              {contractors.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="rounded-xl bg-gray-50 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              План <span className="font-normal normal-case">(в Этапе 2 — автоматически из ПЛАН-Р)</span>
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-gray-600">
                  Начало <span className="text-red-500">*</span>
                </label>
                <input type="date" required value={planStart}
                  onChange={(e) => setPlanStart(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">
                  Окончание <span className="text-red-500">*</span>
                </label>
                <input type="date" required value={planFinish}
                  onChange={(e) => setPlanFinish(e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-[#00823C]/5 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#00823C]">
              Факт
            </p>
            <div className="mb-3">
              <label className="mb-1 block text-xs text-gray-600">Готовность работы, %</label>
              <input type="number" min={0} max={100} step="0.01" required
                value={percentDone} onChange={(e) => setPercentDone(e.target.value)}
                className={inputCls} />
              <p className="mt-1 text-xs text-gray-400">
                Заполняется исполнителем и переносится в черновик недельного отчёта.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-gray-600">Начало</label>
                <input type="date" value={factStart}
                  onChange={(e) => setFactStart(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600">Окончание</label>
                <input type="date" value={factFinish} disabled={finishLocked}
                  onChange={(e) => setFactFinish(e.target.value)}
                  className={`${inputCls} disabled:bg-gray-100 disabled:text-gray-400`} />
                {finishLocked && (
                  <p className="mt-1 text-xs text-gray-400">
                    Доступно при 100% выполнения (сейчас {percent}%)
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button type="button" onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">
              Отмена
            </button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[#00823C] px-5 py-2 text-sm font-medium text-white hover:bg-[#006e33] disabled:opacity-60">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
