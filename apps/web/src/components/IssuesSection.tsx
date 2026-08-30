'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Archive, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { api, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { toInputDate } from '@/lib/format';
import { ISSUE_STATUS_LABELS } from '@/lib/types';
import type { Issue, IssueStatus } from '@/lib/types';

interface RowState {
  id?: string;
  description: string;
  status: IssueStatus;
  action: string;
  responsible: string;
  dueDate: string;
  resolvedDate: string;
  isArchived: boolean;
}

const cell =
'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none transition focus:border-[#00823C] focus:ring-2 focus:ring-[#00823C]/20 disabled:bg-gray-50 disabled:text-gray-400';
// ПР-6.1: раскрывающееся поле — по клику становится textarea с полным текстом
function ExpandableCell({
  value, onChange, disabled, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);

  if (open && !disabled) {
    return (
      <textarea
        autoFocus
        value={value}
        maxLength={500}
        rows={4}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setOpen(false)}
        placeholder={placeholder}
        className="w-full resize-y rounded-md border border-[#00823C] px-2 py-1.5 text-sm outline-none ring-2 ring-[#00823C]/20"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title={value || placeholder}
      className={`w-full rounded-md border border-gray-300 px-2 py-1.5 text-left text-sm transition hover:border-[#00823C] ${
        disabled ? 'cursor-default bg-gray-50 text-gray-500' : 'bg-white'
      }`}
    >
      {value ? (
        <span className="line-clamp-2 whitespace-pre-wrap break-words">{value}</span>
      ) : (
        <span className="text-gray-400">{placeholder}</span>
      )}
    </button>
  );
}

const statusBg: Record<IssueStatus, string> = {
  red: 'bg-red-50',
  yellow: 'bg-amber-50',
  green: 'bg-green-50',
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function IssuesSection({ reportId, readOnly }: { reportId: string; readOnly: boolean }) {
  const token = useAuth((s) => s.token);

  const [rows, setRows] = useState<RowState[]>([]);
  const [archived, setArchived] = useState<RowState[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<Issue[]>(`/reports/${reportId}/issues`, { token });
      const map = (i: Issue): RowState => ({
        id: i.id,
        description: i.description,
        status: i.status,
        action: i.action,
        responsible: i.responsible ?? '',
        dueDate: toInputDate(i.dueDate),
        resolvedDate: toInputDate(i.resolvedDate),
        isArchived: i.isArchived,
      });
      setRows(data.filter((i) => !i.isArchived).map(map));
      setArchived(data.filter((i) => i.isArchived).map(map));
    } catch (err) {
      setError(errText(err, 'Не удалось загрузить проблематику'));
    } finally {
      setLoading(false);
    }
  }, [reportId, token]);

  useEffect(() => { load(); }, [load]);

  function upd(i: number, patch: Partial<RowState>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((r) => [
      ...r,
      {
        description: '', status: 'yellow', action: '',
        responsible: '', dueDate: todayISO(), resolvedDate: '', isArchived: false,
      },
    ]);
  }

  function removeRow(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i));
  }

  async function save() {
    // Г1 и Г3 обязательны на бэке — проверяем заранее
    const bad = rows.findIndex((r) => !r.description.trim() || !r.action.trim());
    if (bad >= 0) {
      setError(`Проблема #${bad + 1}: заполните «Описание» и «Мероприятие»`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // ВАЖНО: архивные тоже отправляем — PUT пересоздаёт секцию целиком
      const payload = [...rows, ...archived].map((r) => ({
        description: r.description.trim(),
        status: r.status,
        action: r.action.trim(),
        responsible: r.responsible.trim() || null,
        dueDate: r.dueDate,
        resolvedDate: r.resolvedDate || null,
        isArchived: r.isArchived,
        ...(r.id ? { id: r.id } : {}),
      }));

      const res = await api<{ data: Issue[]; warnings: string[] }>(
        `/reports/${reportId}/issues`,
        { method: 'PUT', token, body: JSON.stringify({ issues: payload }) },
      );
      setWarnings(res.warnings ?? []);
      setSavedAt(new Date().toLocaleTimeString('ru-RU'));
      load();
    } catch (err) {
      setError(errText(err, 'Не удалось сохранить проблематику'));
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

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-[#28282D]">Секция З — Проблематика</h2>
        {!readOnly && (
          <div className="flex items-center gap-2">
            {savedAt && <span className="text-xs text-[#00823C]">Сохранено в {savedAt}</span>}
            <button onClick={addRow}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-[#28282D] transition hover:border-[#00823C] hover:text-[#00823C]">
              <Plus className="h-4 w-4" /> Добавить проблему
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
        <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white py-10 text-center text-sm text-gray-400">
          Проблем нет. {!readOnly && 'Нажмите «Добавить проблему».'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-3">Описание проблемы</th>
                <th className="w-36 px-3 py-3">Статус</th>
                <th className="px-3 py-3">Мероприятие</th>
                <th className="w-40 px-3 py-3">Ответственный</th>
                <th className="w-36 px-3 py-3">Срок</th>
                <th className="w-36 px-3 py-3">Устранено</th>
                {!readOnly && <th className="w-12 px-3 py-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r, i) => (
                <tr key={r.id ?? `new-${i}`} className={statusBg[r.status]}>
                  <td className="px-3 py-2 align-top">
                    <ExpandableCell value={r.description} disabled={readOnly}
                      onChange={(v) => upd(i, { description: v })}
                      placeholder="Что за проблема (клик — развернуть)" />
                  </td>
                  <td className="px-3 py-2">
                    <select value={r.status} disabled={readOnly}
                      onChange={(e) => upd(i, { status: e.target.value as IssueStatus })}
                      className={cell}>
                      {(Object.keys(ISSUE_STATUS_LABELS) as IssueStatus[]).map((s) => (
                        <option key={s} value={s}>{ISSUE_STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <ExpandableCell value={r.action} disabled={readOnly}
                      onChange={(v) => upd(i, { action: v })}
                      placeholder="Что делаем (клик — развернуть)" />
                  </td>
                  <td className="px-3 py-2">
                    <input value={r.responsible} disabled={readOnly} maxLength={100}
                      onChange={(e) => upd(i, { responsible: e.target.value })}
                      placeholder="Иванов И.И." className={cell} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="date" value={r.dueDate} disabled={readOnly}
                      onChange={(e) => upd(i, { dueDate: e.target.value })} className={cell} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="date" value={r.resolvedDate} disabled={readOnly}
                      onChange={(e) => upd(i, { resolvedDate: e.target.value })} className={cell} />
                  </td>
                  {!readOnly && (
                    <td className="px-3 py-2 text-center">
                      <button onClick={() => removeRow(i)} title="Удалить строку"
                        className="rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {archived.length > 0 && (
        <details className="mt-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm text-gray-500">
            <Archive className="mr-1.5 inline h-4 w-4" />
            Архив проблем ({archived.length})
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-gray-500">
            {archived.map((a, i) => (
              <li key={i}>• {a.description} — {ISSUE_STATUS_LABELS[a.status]}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
