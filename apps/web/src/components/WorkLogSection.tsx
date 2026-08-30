'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { api, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import type { Contractor, Section, WorkLogItem } from '@/lib/types';

interface RowState {
  contractorId: string;
  sectionId: string;
  description: string;
  percentDone: string;
}

const cell =
  'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none transition focus:border-[#00823C] focus:ring-2 focus:ring-[#00823C]/20 disabled:bg-gray-50 disabled:text-gray-400';

export function WorkLogSection({
  reportId, projectId, readOnly,
}: {
  reportId: string;
  projectId: string;
  readOnly: boolean;
}) {
  const token = useAuth((s) => s.token);

  const [rows, setRows] = useState<RowState[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wl, cs, ss] = await Promise.all([
        api<{ items: WorkLogItem[] }>(`/reports/${reportId}/worklog`, { token }),
        api<Contractor[]>(`/projects/${projectId}/contractors`, { token }),
        api<Section[]>(`/projects/${projectId}/sections`, { token }),
      ]);
      setContractors(cs);
      setSections(ss);
      setRows(
        wl.items.map((i) => ({
          contractorId: i.contractorId,
          sectionId: i.sectionId ?? '',
          description: i.description,
          percentDone: i.percentDone != null ? String(i.percentDone) : '',
        })),
      );
    } catch (err) {
      setError(errText(err, 'Не удалось загрузить перечень работ'));
    } finally {
      setLoading(false);
    }
  }, [reportId, projectId, token]);

  useEffect(() => { load(); }, [load]);

  function upd(i: number, patch: Partial<RowState>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  /** ПР-6.5: подтянуть работы из раздела — наименование, подрядчик, % */
  function pullFromSections() {
    const existing = new Set(rows.map((r) => `${r.sectionId}|${r.description}`));
    const added: RowState[] = [];
    for (const s of sections) {
      const key = `${s.id}|${s.name}`;
      if (existing.has(key)) continue;
      added.push({
        contractorId: s.contractorId ?? contractors[0]?.id ?? '',
        sectionId: s.id,
        description: s.name,
        percentDone: s.percentDone != null ? String(s.percentDone) : '',
      });
    }
    if (added.length === 0) {
      setError('Все разделы уже добавлены в перечень');
      return;
    }
    setError(null);
    setRows((r) => [...r, ...added]);
  }

  function addRow() {
    setRows((r) => [
      ...r,
      { contractorId: contractors[0]?.id ?? '', sectionId: '', description: '', percentDone: '' },
    ]);
  }

  async function save() {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.contractorId) { setError(`Строка ${i + 1}: выберите подрядчика`); return; }
      if (!r.description.trim()) { setError(`Строка ${i + 1}: укажите наименование работы`); return; }
      const p = r.percentDone === '' ? null : Number(r.percentDone);
      if (p !== null && (p < 0 || p > 100)) {
        setError(`Строка ${i + 1}: процент выполнения должен быть от 0 до 100`); return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      const payload = rows.map((r) => ({
        contractorId: r.contractorId,
        sectionId: r.sectionId || null,
        description: r.description.trim(),
        percentDone: r.percentDone === '' ? null : Number(r.percentDone),
      }));

      await api(`/reports/${reportId}/worklog`, {
        method: 'PUT', token, body: JSON.stringify(payload),
      });
      setSavedAt(new Date().toLocaleTimeString('ru-RU'));
    } catch (err) {
      setError(errText(err, 'Не удалось сохранить перечень работ'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-gray-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загрузка секции Г…
      </div>
    );
  }

  const noContractors = contractors.length === 0;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-[#28282D]">
          Секция Г — Выполняемые работы за отчётный период
        </h2>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            {savedAt && <span className="text-xs text-[#00823C]">Сохранено в {savedAt}</span>}
            <button onClick={pullFromSections} disabled={sections.length === 0}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-[#28282D] transition hover:border-[#00823C] hover:text-[#00823C] disabled:opacity-50">
              Подтянуть из разделов
            </button>
            <button onClick={addRow} disabled={noContractors}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-[#28282D] transition hover:border-[#00823C] hover:text-[#00823C] disabled:opacity-50">
              <Plus className="h-4 w-4" /> Добавить работу
            </button>
            <button onClick={save} disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-[#00823C] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#006e33] disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Сохранить секцию
            </button>
          </div>
        )}
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {noContractors && (
        <div className="mb-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          У проекта нет подрядчиков. Добавьте их на вкладке «Подрядчики».
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white py-10 text-center text-sm text-gray-400">
          Работ за период нет. {!readOnly && 'Нажмите «Подтянуть из разделов» или «Добавить работу».'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full min-w-[850px] text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-3">Наименование работы</th>
                <th className="w-48 px-3 py-3">Подрядчик</th>
                <th className="w-44 px-3 py-3">Раздел</th>
                <th className="w-40 px-3 py-3">Выполнение, %</th>
                {!readOnly && <th className="w-12 px-3 py-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r, i) => {
                const p = r.percentDone === '' ? null : Number(r.percentDone);
                return (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      <input value={r.description} disabled={readOnly} maxLength={1000}
                        onChange={(e) => upd(i, { description: e.target.value })}
                        placeholder="Устройство фундаментов" className={cell} />
                    </td>
                    <td className="px-3 py-2">
                      <select value={r.contractorId} disabled={readOnly}
                        onChange={(e) => upd(i, { contractorId: e.target.value })} className={cell}>
                        <option value="">— выберите —</option>
                        {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select value={r.sectionId} disabled={readOnly}
                        onChange={(e) => upd(i, { sectionId: e.target.value })} className={cell}>
                        <option value="">— не указан —</option>
                        {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <input type="number" min={0} max={100} value={r.percentDone} disabled={readOnly}
                          onChange={(e) => upd(i, { percentDone: e.target.value })}
                          placeholder="—" className={`${cell} w-20`} />
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full bg-[#00823C]"
                            style={{ width: `${Math.min(Math.max(p ?? 0, 0), 100)}%` }} />
                        </div>
                      </div>
                    </td>
                    {!readOnly && (
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => setRows((rr) => rr.filter((_, idx) => idx !== i))}
                          title="Удалить строку"
                          className="rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}