'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { SECTION_DEFINITIONS, type SectionKey } from '@rost/shared/types';
import { api, ApiError, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useAccess } from '@/stores/access';
import type { ReportListItem } from '@/lib/types';
import { BudgetSection } from '@/components/BudgetSection';
import { RdDevelopmentSection } from '@/components/RdDevelopmentSection';
import { WorkLogSection } from '@/components/WorkLogSection';
import { PrescriptionsSection } from '@/components/PrescriptionsSection';
import { ResourcesSection } from '@/components/ResourcesSection';
import { IssuesSection } from '@/components/IssuesSection';
import { PhotosSection } from '@/components/PhotosSection';
import { SectionVersionsPanel, type WorkspaceStatus } from '@/components/SectionVersionsPanel';
import { ScheduleTab } from '@/components/ScheduleTab';

const editableSections = SECTION_DEFINITIONS.filter(
  (section) => section.source === 'report' || section.key === 'schedule',
).map((section) => section.key);

/**
 * Правки v5: сотрудники заполняют основные разделы прямо в карточке проекта.
 * Технический черновик недели создаётся автоматически и остаётся единым
 * источником для этой панели и для привычного экрана отчёта.
 */
export function ReportSectionsTab({ projectId }: { projectId: string }) {
  const token = useAuth((state) => state.token);
  const canEdit = useAccess((state) => state.canEdit);
  const [report, setReport] = useState<ReportListItem | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canEditAny = useMemo(
    () => editableSections.some((sectionKey) => canEdit(sectionKey, projectId)),
    [canEdit, projectId],
  );

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      let rows = await api<ReportListItem[]>(`/projects/${projectId}/reports`, { token });
      let current = rows.find((item) => item.status === 'draft') ?? null;

      // Сотруднику не требуется отдельно идти на вкладку «Отчёты».
      if (!current && canEditAny) {
        try {
          current = await api<ReportListItem>(`/projects/${projectId}/reports`, {
            method: 'POST', token, body: JSON.stringify({}),
          });
        } catch (createError) {
          // Другой сотрудник мог создать ту же неделю одновременно.
          if (!(createError instanceof ApiError && createError.status === 409)) throw createError;
          rows = await api<ReportListItem[]>(`/projects/${projectId}/reports`, { token });
          current = rows.find((item) => item.status === 'draft') ?? null;
        }
      }

      // Наблюдатель без активного черновика видит последнюю выпущенную неделю.
      setReport(current ?? rows[0] ?? null);
    } catch (loadError) {
      setError(errText(loadError, 'Не удалось открыть рабочие разделы'));
    } finally {
      setLoading(false);
    }
  }, [canEditAny, projectId, token]);

  useEffect(() => { void load(); }, [load]);

  function readOnly(sectionKey: SectionKey) {
    return report?.status === 'finalized'
      || workspaces.some((item) => item.sectionKey === sectionKey && item.freshness === 'fresh')
      || !canEdit(sectionKey, projectId);
  }

  if (loading) return (
    <div className="flex items-center justify-center rounded-2xl bg-white py-16 text-gray-400">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Подготавливаем рабочие разделы…
    </div>
  );

  if (error || !report) return (
    <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white px-6 py-16 text-center text-sm text-gray-500">
      {error ?? 'Отчётов пока нет. Рабочая неделя появится при входе сотрудника с правом редактирования.'}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-green-200 bg-white px-5 py-4">
        <h2 className="font-bold text-[#28282D]">Рабочие разделы текущей недели</h2>
        <p className="mt-1 text-sm text-gray-500">
          Все сотрудники видят разделы, а редактируют только назначенные. Зафиксированный раздел открывается после создания корректировки.
        </p>
        {report.status === 'finalized' && (
          <p className="mt-2 flex items-center gap-2 text-sm text-gray-500"><Lock className="h-4 w-4" /> Показана последняя финализированная версия.</p>
        )}
      </div>

      <SectionVersionsPanel projectId={projectId} onStatusesChange={setWorkspaces} />
      <div id="workspace-budget"><BudgetSection reportId={report.id} readOnly={readOnly('budget')} /></div>
      <div id="workspace-rd"><RdDevelopmentSection reportId={report.id} readOnly={readOnly('rd')} /></div>
      <div id="workspace-worklog"><WorkLogSection reportId={report.id} projectId={projectId} readOnly={readOnly('worklog')} /></div>
      {/* Правки v6: график относится к составу отчёта и актуализируется здесь. */}
      <div id="workspace-schedule"><ScheduleTab projectId={projectId} /></div>
      <div id="workspace-prescriptions"><PrescriptionsSection reportId={report.id} readOnly={readOnly('prescriptions')} /></div>
      <div id="workspace-resources"><ResourcesSection reportId={report.id} readOnly={readOnly('resources')} /></div>
      <div id="workspace-issues"><IssuesSection reportId={report.id} readOnly={readOnly('issues')} /></div>
      <div id="workspace-photos"><PhotosSection reportId={report.id} projectId={projectId} readOnly={readOnly('photos')} /></div>
    </div>
  );
}
