'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, CheckCircle2, FileText, Loader2, Plus, Trash2, X } from 'lucide-react';
import { api, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { fmtDate } from '@/lib/format';
import type { ReportListItem } from '@/lib/types';
import { CAN_DELETE_REPORT } from '@/lib/types';
import { useConfirm } from '@/components/ConfirmDialog';

export function ReportsTab({ projectId }: { projectId: string }) {
  const token = useAuth((s) => s.token);
  const router = useRouter();

  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const currentUser = useAuth((s) => s.user);
  const confirm = useConfirm();
  const canCreate = Boolean(currentUser); // персональная ссылка заполняет, но не создаёт отчёты
  const canDelete = Boolean(currentUser?.role && CAN_DELETE_REPORT.includes(currentUser.role));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReports(await api<ReportListItem[]>(`/projects/${projectId}/reports`, { token }));
    } catch (err) {
      setError(errText(err, 'Не удалось загрузить отчёты'));
    } finally {
      setLoading(false);
    }
  }, [projectId, token]);

  useEffect(() => { load(); }, [load]);

    async function removeReport(r: ReportListItem) {
    const ok = await confirm({
      message: `Удалить отчёт за ${fmtDate(r.weekFriday)} (v${r.version})?`,
      description: 'Все данные секций этого отчёта будут удалены безвозвратно.',
      confirmText: 'Удалить отчёт',
    });
    if (!ok) return;
    try {
      await api(`/reports/${r.id}`, { method: 'DELETE', token });
      load();
    } catch (err) {
      setError(errText(err, 'Не удалось удалить отчёт'));
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
        <h3 className="text-lg font-bold text-[#28282D]">Еженедельные отчёты</h3>
        {canCreate && (
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-2 rounded-lg bg-[#00823C] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#006e33]">
            <Plus className="h-4 w-4" /> Создать отчёт
          </button>
        )}
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {reports.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white py-16 text-center text-gray-400">
          {canCreate
            ? 'Отчётов пока нет. Создайте первый — за текущую неделю (пятница).'
            : 'Отчётов пока нет.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Отчётная неделя</th>
                <th className="px-4 py-3">Версия</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Финализирован</th>
                {canDelete && <th className="w-12 px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reports.map((r) => (
                <tr key={r.id}
                  onClick={() => router.push(`/projects/${projectId}/reports/${r.id}`)}
                  className="cursor-pointer hover:bg-gray-50/60">
                  <td className="px-4 py-3 font-medium text-[#28282D]">
                    <span className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-gray-400" />
                      {fmtDate(r.weekFriday)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    v{r.version}{r.parentReportId && ' (корректировка)'}
                  </td>
                  <td className="px-4 py-3">
                    {r.status === 'finalized' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-[#00823C]">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Финализирован
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                        <FileText className="h-3.5 w-3.5" /> Черновик
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {r.finalizedAt ? fmtDate(r.finalizedAt) : '—'}
                  </td>
                  {canDelete && (
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => removeReport(r)} title="Удалить отчёт"
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

      {creating && (
        <CreateReportModal
          projectId={projectId}
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/projects/${projectId}/reports/${id}`)}
        />
      )}
    </div>
  );
}

function CreateReportModal({
  projectId, onClose, onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (reportId: string) => void;
}) {
  const token = useAuth((s) => s.token);
  const confirm = useConfirm();
  const [weekFriday, setWeekFriday] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      const body = weekFriday ? JSON.stringify({ weekFriday }) : JSON.stringify({});
      const rep = await api<{ id: string }>(`/projects/${projectId}/reports`, {
        method: 'POST', token, body,
      });
      onCreated(rep.id);
    } catch (e2) {
      setErr(errText(e2, 'Не удалось создать отчёт'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h3 className="text-lg font-bold text-[#28282D]">Новый отчёт</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 p-6">
          {err && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

          <div>
            <label className="mb-1 block text-sm font-medium text-[#28282D]">
              Отчётная пятница
            </label>
            <input type="date" value={weekFriday}
              onChange={(e) => setWeekFriday(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-[#00823C] focus:ring-2 focus:ring-[#00823C]/20" />
            <p className="mt-1 text-xs text-gray-400">
              Оставьте пустым — система подставит текущую пятницу (МСК)
            </p>
          </div>

          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button type="button" onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">
              Отмена
            </button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[#00823C] px-5 py-2 text-sm font-medium text-white hover:bg-[#006e33] disabled:opacity-60">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'Создание…' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
