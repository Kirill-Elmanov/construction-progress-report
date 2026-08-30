'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { SectionKey } from '@rost/shared/types';
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, Loader2, Lock, Save } from 'lucide-react';
import { api, apiBlobUrl, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { fmtDate, toInputDate } from '@/lib/format';
import { CAN_FINALIZE, REPORT_SECTIONS } from '@/lib/types';
import type { ProgressRow, ProgressWarning, ReportFull, Section } from '@/lib/types';
import { AuthGuard } from '@/components/AuthGuard';
import { IssuesSection } from '@/components/IssuesSection';
import { PrescriptionsSection } from '@/components/PrescriptionsSection';
import { BudgetSection } from '@/components/BudgetSection';
import { RdDevelopmentSection } from '@/components/RdDevelopmentSection';
import { ResourcesSection } from '@/components/ResourcesSection';
import { WorkLogSection } from '@/components/WorkLogSection';
import { PhotosSection } from '@/components/PhotosSection';
import { FinalizeDialog, type SectionFillStatus } from '@/components/FinalizeDialog';
import { useConfirm } from '@/components/ConfirmDialog';
import { useAccess } from '@/stores/access';
import { SectionVersionsPanel, type WorkspaceStatus } from '@/components/SectionVersionsPanel';

interface RowState {
  sectionId: string;
  name: string;
  code: string | null;
  percentDone: string;
  factStart: string;
  factFinish: string;
  comment: string;
  isCritical: boolean;
}

const cellInput =
  'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none transition focus:border-[#00823C] focus:ring-2 focus:ring-[#00823C]/20 disabled:bg-gray-50 disabled:text-gray-400';

/** Правки v5: единая навигация — вертикальная на широком экране и компактная на мобильном. */
function ReportNavigation({ projectId, vertical = false }: { projectId: string; vertical?: boolean }) {
  return (
    <nav className={`border border-gray-200 bg-white/95 shadow-sm backdrop-blur ${
      vertical ? 'rounded-2xl p-3' : 'overflow-x-auto rounded-xl px-2'
    }`}>
      <div className={vertical ? 'space-y-1' : 'flex min-w-max gap-1 py-2'}>
        {REPORT_SECTIONS.map((section) => {
          const href = section.source === 'project'
            ? section.key === 'object'
              ? `/projects/${projectId}?tab=sections`
              : `/projects/${projectId}?tab=reportSections#workspace-schedule`
            : `#section-${section.key}`;
          return (
            <a key={section.key} href={href}
              className={`flex rounded-lg text-sm font-medium text-gray-600 transition hover:bg-[#00823C]/10 hover:text-[#00823C] ${
                vertical ? 'items-start gap-3 px-3 py-2.5' : 'px-3 py-2'
              }`}>
              {vertical && (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#F2FAE3] text-xs font-bold text-[#00823C]">
                  {section.letter}
                </span>
              )}
              <span>{vertical ? section.title : `${section.letter} · ${section.title}`}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}

interface PdfScope { scopeId: string; scopeName: string; scopeCode: string | null; depth: number }

function ReportContent() {
  const { id: projectId, reportId } = useParams<{ id: string; reportId: string }>();
  const router = useRouter();
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);
  const confirm = useConfirm();

  const [report, setReport] = useState<ReportFull | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [warnings, setWarnings] = useState<ProgressWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizeBusy, setFinalizeBusy] = useState(false);
  const [fillStatus, setFillStatus] = useState<SectionFillStatus[]>([]);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfScopes, setPdfScopes] = useState<PdfScope[]>([]);
  const [pdfScope, setPdfScope] = useState('__project__');
  const [workspaceStatuses, setWorkspaceStatuses] = useState<WorkspaceStatus[]>([]);
  
  const canEditSection = useAccess((s) => s.canEdit);
  const checkAccess = useAccess((s) => s.check);
  const whoLink = useAccess((s) => s.who);

  useEffect(() => { checkAccess(); }, [checkAccess]);

  const canFinalize = Boolean(user?.role && CAN_FINALIZE.includes(user.role));
  const readOnly = report?.status === 'finalized';
  const workspaceLocked = useCallback(
    (sectionKey: SectionKey) => workspaceStatuses.some(
      (item) => item.sectionKey === sectionKey && item.freshness === 'fresh',
    ),
    [workspaceStatuses],
  );
  const canEditProgress = canEditSection('worklog', projectId) && !workspaceLocked('worklog');
  const sectionReadOnly = (sectionKey: SectionKey) => (
    Boolean(readOnly) || workspaceLocked(sectionKey) || !canEditSection(sectionKey, projectId)
  );
  const handleWorkspaceStatuses = useCallback((items: WorkspaceStatus[]) => {
    setWorkspaceStatuses(items);
  }, []);

  useEffect(() => {
    if (report?.status !== 'finalized') { setPdfScopes([]); return; }
    api<PdfScope[]>(`/reports/${report.id}/pdf-scopes`, { token })
      .then((items) => {
        setPdfScopes(items);
        setPdfScope(items.some((item) => item.scopeId === '__project__') ? '__project__' : (items[0]?.scopeId ?? '__project__'));
      })
      .catch(() => setPdfScopes([]));
  }, [report?.id, report?.status, token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rep, sections, progress] = await Promise.all([
        api<ReportFull>(`/reports/${reportId}`, { token }),
        api<Section[]>(`/projects/${projectId}/sections`, { token }),
        api<ProgressRow[]>(`/reports/${reportId}/progress`, { token }),
      ]);
      setReport(rep);

      const saved = new Map(progress.map((p) => [p.sectionId, p]));
      setRows(
        sections.map((s) => {
          const p = saved.get(s.id);
          return {
            sectionId: s.id,
            name: s.name,
            code: s.code,
            // Правки v3: новый отчёт подхватывает текущие данные исполнителя.
            percentDone: String(p?.percentDone ?? s.percentDone ?? 0),
            factStart: toInputDate(p?.factStart ?? s.factStart),
            factFinish: toInputDate(p?.factFinish ?? s.factFinish),
            comment: p?.comment ?? '',
            isCritical: p?.isCritical ?? false,
          };
        }),
      );
    } catch (err) {
      setError(errText(err, 'Не удалось загрузить отчёт'));
    } finally {
      setLoading(false);
    }
  }, [projectId, reportId, token]);

  useEffect(() => { load(); }, [load]);

  function upd(i: number, patch: Partial<RowState>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ data: unknown[]; warnings: ProgressWarning[] }>(
        `/reports/${reportId}/progress`,
        {
          method: 'PUT',
          token,
          body: JSON.stringify({
            progress: rows.map((r) => ({
              sectionId: r.sectionId,
              percentDone: Number(r.percentDone || 0),
              factStart: r.factStart || null,
              factFinish: r.factFinish || null,
              comment: r.comment.trim() || null,
              isCritical: r.isCritical,
            })),
          }),
        },
      );
      setWarnings(res.warnings ?? []);
      setSavedAt(new Date().toLocaleTimeString('ru-RU'));
    } catch (err) {
      setError(errText(err, 'Не удалось сохранить прогресс'));
    } finally {
      setSaving(false);
    }
  }

  // ТЗ К4 + ПР-5.1: собираем статус заполненности секций перед формированием
  async function openFinalize() {
    setFinalizeBusy(true);
    setError(null);
    try {
      const [budget, rd, work, presc, res, issues, photos, audit, workspaces] = await Promise.all([
        api<any>(`/reports/${reportId}/budget`, { token }).catch(() => null),
        api<any>(`/reports/${reportId}/rd-development`, { token }).catch(() => null),
        api<any>(`/reports/${reportId}/worklog`, { token }).catch(() => null),
        api<any>(`/reports/${reportId}/prescriptions`, { token }).catch(() => null),
        api<any>(`/reports/${reportId}/resources`, { token }).catch(() => null),
        api<any>(`/reports/${reportId}/issues`, { token }).catch(() => null),
        api<any>(`/reports/${reportId}/photos`, { token }).catch(() => null),
        api<any>(`/reports/${reportId}/audit`, { token }).catch(() => null),
        api<any[]>(`/projects/${projectId}/section-workspaces`, { token }).catch(() => []),
      ]);

      const ed = (key: string) => {
        const e = audit?.bySection?.[key];
        return e ? { name: e.actorName, role: e.actorRole, at: e.at } : null;
      };
      const ws = (key: string) => workspaces.find((item) => item.sectionKey === key);
      const versionState = (key: string) => ({
        freshness: ws(key)?.freshness ?? 'missing',
        version: ws(key)?.currentRevision?.version ?? null,
      });

      setFillStatus([
        { key: 'object', label: 'А — Информация об объекте', filled: true, editor: null },
        { key: 'budget', label: 'Б — Бюджет', filled: !!budget && ((budget.paidGp ?? 0) > 0 || (budget.worksAccepted ?? 0) > 0), editor: ed('budget'), ...versionState('budget') },
        { key: 'rd', label: 'В — Разработка РД', filled: !!rd && (rd.volumesTotal ?? 0) > 0, editor: ed('rd'), ...versionState('rd') },
        { key: 'worklog', label: 'Г — Выполняемые работы', filled: !!work && (work.items?.length ?? 0) > 0, editor: ed('worklog'), ...versionState('worklog') },
        { key: 'schedule', label: 'Д — График работ', filled: true, editor: null },
        { key: 'prescriptions', label: 'Е — Предписания', filled: !!presc && (presc.issuedTotal ?? 0) > 0, editor: ed('prescriptions'), ...versionState('prescriptions') },
        { key: 'resources', label: 'Ж — Привлечённые ресурсы', filled: !!res && ((res.itr ?? 0) > 0 || (res.workers ?? 0) > 0 || (res.machinery ?? 0) > 0), editor: ed('resources'), ...versionState('resources') },
        { key: 'issues', label: 'З — Проблематика', filled: Array.isArray(issues) && issues.length > 0, editor: ed('issues'), ...versionState('issues') },
        { key: 'photos', label: 'И — Фотоотчёт', filled: !!photos && (photos.items?.length ?? 0) > 0, editor: ed('photos'), ...versionState('photos') },
      ]);

      setFinalizeOpen(true);
    } catch (err) {
      setError(errText(err, 'Не удалось проверить заполненность секций'));
    } finally {
      setFinalizeBusy(false);
    }
  }

  async function doFinalize(enabledSections: string[]) {
    setFinalizeBusy(true);
    try {
      // ПР-5.1: сначала сохраняем состав секций, затем финализируем
      await api(`/reports/${reportId}/sections-config`, {
        method: 'PATCH', token,
        body: JSON.stringify({ enabledSections }),
      });
      await api(`/reports/${reportId}/finalize`, { method: 'POST', token });
      setFinalizeOpen(false);
      load();
    } catch (err) {
      setError(errText(err, 'Не удалось сформировать отчёт'));
      setFinalizeOpen(false);
    } finally {
      setFinalizeBusy(false);
    }
  }

  // ТЗ К: корректировка — только ПЗГД, только последний finalized
  async function amend() {
    const ok = await confirm({
      message: `Создать корректировку (версия v${report!.version + 1})?`,
      description: 'Все данные текущего отчёта будут скопированы в новую версию и снова станут редактируемыми.',
      confirmText: 'Создать',
      tone: 'normal',
    });
    if (!ok) return;
    try {
      const created = await api<{ id: string }>(`/reports/${reportId}/amend`, { method: 'POST', token });
      router.push(`/projects/${projectId}/reports/${created.id}`);
    } catch (err) {
      setError(errText(err, 'Не удалось создать корректировку'));
    }
  }

  async function downloadPdf() {
    if (!report) return;
    setPdfBusy(true); setError(null);
    try {
      const url = await apiBlobUrl(`/reports/${reportId}/pdf?scope=${encodeURIComponent(pdfScope)}`, token);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `rost-report-${report.weekFriday.slice(0, 10)}-v${report.version}.pdf`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(errText(err, 'Не удалось сформировать PDF'));
    } finally { setPdfBusy(false); }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F2FAE3] text-gray-400">
        <Loader2 className="mr-2 h-6 w-6 animate-spin" /> Загрузка отчёта…
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F2FAE3]">
        <p className="text-red-600">{error ?? 'Отчёт не найден'}</p>
        <button onClick={() => router.push(`/projects/${projectId}`)}
          className="rounded-lg bg-[#00823C] px-4 py-2 text-white">К проекту</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F2FAE3]">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <button onClick={() => router.push(`/projects/${projectId}`)}
            className="mb-3 flex items-center gap-1.5 text-sm text-gray-500 transition hover:text-[#00823C]">
            <ArrowLeft className="h-4 w-4" /> К проекту
          </button>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-[#28282D]">
                Отчёт за неделю {fmtDate(report.weekFriday)}
              </h1>
              <p className="mt-0.5 flex items-center gap-2 text-sm text-gray-500">
                Версия {report.version} ·
                {report.status === 'finalized' ? (
                  <span className="inline-flex items-center gap-1 text-[#00823C]">
                    <CheckCircle2 className="h-4 w-4" /> Финализирован
                  </span>
                ) : (
                  <span className="text-amber-600">Черновик</span>
                )}
              </p>
            </div>

            <div className="flex gap-2">
              {readOnly && (
                <div className="flex gap-2">
                  {pdfScopes.length > 1 && (
                    <select value={pdfScope} onChange={(event) => setPdfScope(event.target.value)}
                      aria-label="Объект S-кривой в PDF"
                      className="max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                      {pdfScopes.map((item) => (
                        <option key={item.scopeId} value={item.scopeId}>
                          {'— '.repeat(item.depth)}{item.scopeCode ? `${item.scopeCode} · ` : ''}{item.scopeName}
                        </option>
                      ))}
                    </select>
                  )}
                  <button onClick={downloadPdf} disabled={pdfBusy}
                    className="flex items-center gap-2 rounded-lg bg-[#00823C] px-4 py-2 text-sm font-medium text-white hover:bg-[#006e33] disabled:opacity-60">
                    {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Скачать PDF
                  </button>
                </div>
              )}
              {!readOnly && canEditProgress && (
                <button onClick={save} disabled={saving}
                  className="flex items-center gap-2 rounded-lg bg-[#00823C] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#006e33] disabled:opacity-60">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Сохранение…' : 'Сохранить'}
                </button>
              )}
              {!readOnly && canFinalize && whoLink?.kind !== 'link' && (
                <button onClick={openFinalize} disabled={finalizeBusy}
                  className="flex items-center gap-2 rounded-lg border border-[#00823C] px-4 py-2 text-sm font-medium text-[#00823C] transition hover:bg-[#00823C]/5 disabled:opacity-60">
                  {finalizeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                  Сформировать отчёт
                </button>
              )}
              {readOnly && canFinalize && (
                <button onClick={amend}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-[#28282D] transition hover:border-[#00823C] hover:text-[#00823C]">
                  Создать корректировку
                </button>
              )}
            </div>
          </div>

          {savedAt && !error && (
            <p className="mt-2 text-xs text-[#00823C]">Сохранено в {savedAt}</p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6">
        <div className="grid items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="sticky top-4 hidden lg:block">
            <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Разделы отчёта</p>
            <ReportNavigation projectId={projectId} vertical />
          </aside>

          <div className="min-w-0 space-y-4">
        {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {readOnly && (
          <div className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-3 text-sm text-gray-600">
            <Lock className="h-4 w-4" />
            Отчёт финализирован — редактирование запрещено. Для изменений создайте корректировку.
          </div>
        )}

        {warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="mb-1 flex items-center gap-2 text-sm font-medium text-amber-800">
              <AlertTriangle className="h-4 w-4" /> Предупреждения ({warnings.length})
            </p>
            <ul className="ml-6 list-disc space-y-0.5 text-sm text-amber-700">
              {warnings.map((w, i) => <li key={i}>{w.message}</li>)}
            </ul>
          </div>
        )}

        {/* На телефонах сохраняем горизонтальный вариант навигации. */}
        <div className="sticky top-0 z-20 lg:hidden">
          <ReportNavigation projectId={projectId} />
        </div>

        <SectionVersionsPanel projectId={projectId} onStatusesChange={handleWorkspaceStatuses} />

        <section id="section-progress" className="scroll-mt-20">
          <h2 className="mb-3 text-lg font-bold text-[#28282D]">
            Прогресс по разделам
            <span className="ml-2 text-sm font-normal text-gray-400">
              данные для секции Г и дашборда
            </span>
          </h2>

          {rows.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white py-16 text-center text-gray-400">
              У проекта нет разделов работ. Сначала добавьте их на вкладке «Выполняемые работы».
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-3">Раздел</th>
                    <th className="w-24 px-3 py-3">% вып.</th>
                    <th className="w-40 px-3 py-3">Факт. начало</th>
                    <th className="w-40 px-3 py-3">Факт. окончание</th>
                    <th className="px-3 py-3">Комментарий</th>
                    <th className="w-24 px-3 py-3">Критич.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r, i) => (
                    <tr key={r.sectionId} className={r.isCritical ? 'bg-red-50/40' : ''}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-[#28282D]">{r.name}</p>
                        {r.code && <p className="text-xs text-gray-400">{r.code}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min={0} max={100} disabled={readOnly || !canEditProgress}
                          value={r.percentDone}
                          onChange={(e) => upd(i, { percentDone: e.target.value })}
                          className={cellInput} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="date" disabled={readOnly || !canEditProgress} value={r.factStart}
                          onChange={(e) => upd(i, { factStart: e.target.value })}
                          className={cellInput} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="date" disabled={readOnly || !canEditProgress} value={r.factFinish}
                          onChange={(e) => upd(i, { factFinish: e.target.value })}
                          className={cellInput} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="text" maxLength={500} disabled={readOnly || !canEditProgress}
                          placeholder="—" value={r.comment}
                          onChange={(e) => upd(i, { comment: e.target.value })}
                          className={cellInput} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input type="checkbox" disabled={readOnly || !canEditProgress} checked={r.isCritical}
                          onChange={(e) => upd(i, { isCritical: e.target.checked })}
                          className="h-4 w-4 accent-[#00823C]" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div id="section-budget" className="scroll-mt-20"><BudgetSection reportId={reportId} readOnly={sectionReadOnly('budget')} /></div>
        <div id="section-rd" className="scroll-mt-20"><RdDevelopmentSection reportId={reportId} readOnly={sectionReadOnly('rd')} /></div>
        <div id="section-worklog" className="scroll-mt-20"><WorkLogSection reportId={reportId} projectId={projectId} readOnly={sectionReadOnly('worklog')} /></div>
        <div id="section-prescriptions" className="scroll-mt-20"><PrescriptionsSection reportId={reportId} readOnly={sectionReadOnly('prescriptions')} /></div>
        <div id="section-resources" className="scroll-mt-20"><ResourcesSection reportId={reportId} readOnly={sectionReadOnly('resources')} /></div>
        <div id="section-issues" className="scroll-mt-20"><IssuesSection reportId={reportId} readOnly={sectionReadOnly('issues')} /></div>
        <div id="section-photos" className="scroll-mt-20"><PhotosSection reportId={reportId} projectId={projectId} readOnly={sectionReadOnly('photos')} /></div>
          </div>
        </div>
      </main>

      {finalizeOpen && (
        <FinalizeDialog
          statuses={fillStatus}
          busy={finalizeBusy}
          onCancel={() => setFinalizeOpen(false)}
          onConfirm={doFinalize}
        />
      )}
    </div>
  );
}

export default function ReportPage() {
  return (
    <AuthGuard>
      <ReportContent />
    </AuthGuard>
  );
}
