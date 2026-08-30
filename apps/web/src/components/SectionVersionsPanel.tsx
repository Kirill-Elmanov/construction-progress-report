'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock3, History, Loader2, RefreshCw } from 'lucide-react';
import { SECTION_DEFINITIONS, type DataFreshness, type SectionKey } from '@rost/shared/types';
import { api, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useAccess } from '@/stores/access';

export interface WorkspaceStatus {
  sectionKey: SectionKey;
  freshness: DataFreshness;
  draftUpdatedAt?: string | null;
  draftActor?: { name: string } | null;
  currentRevision: {
    id: string;
    version: number;
    fixedAt: string;
    fixedBy: string;
  } | null;
}

interface WorkspaceDetails extends WorkspaceStatus {
  revisions: Array<{
    id: string;
    version: number;
    fixedAt: string;
    fixedBy: string;
    correctionOfId: string | null;
  }>;
}

const localSections = SECTION_DEFINITIONS.filter((section) => section.source === 'report');

/**
 * Единая панель локальных черновиков. Она не заменяет привычные формы ниже,
 * а показывает руководителю, какие разделы готовы к официальной фиксации.
 */
export function SectionVersionsPanel({
  projectId,
  onStatusesChange,
}: {
  projectId: string;
  onStatusesChange?: (rows: WorkspaceStatus[]) => void;
}) {
  const token = useAuth((state) => state.token);
  const who = useAccess((state) => state.who);
  const [rows, setRows] = useState<WorkspaceStatus[]>([]);
  const [details, setDetails] = useState<Record<string, WorkspaceDetails>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isEmployeeLink = who?.kind === 'link';
  const canManageVersions = Boolean(token) && !isEmployeeLink;

  const load = useCallback(async () => {
    try {
      const data = await api<WorkspaceStatus[]>(
        `/projects/${projectId}/section-workspaces`,
        { token },
      );
      setRows(data);
      onStatusesChange?.(data);
      setError(null);
    } catch (err) {
      setError(errText(err, 'Не удалось загрузить статусы черновиков'));
    } finally {
      setLoading(false);
    }
  }, [onStatusesChange, projectId, token]);

  useEffect(() => { load(); }, [load]);

  // Формы разделов сохраняются независимо. Общий сигнал обновляет статусы
  // сразу после любого успешного сохранения без перезагрузки страницы.
  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener('rost:data-saved', refresh);
    return () => window.removeEventListener('rost:data-saved', refresh);
  }, [load]);

  async function fix(sectionKey: SectionKey) {
    setBusyKey(sectionKey);
    try {
      await api(`/projects/${projectId}/section-workspaces/${sectionKey}/fix`, {
        method: 'POST',
        token,
      });
      await load();
    } catch (err) {
      setError(errText(err, 'Не удалось зафиксировать раздел'));
    } finally {
      setBusyKey(null);
    }
  }

  async function correct(sectionKey: SectionKey) {
    setBusyKey(sectionKey);
    try {
      await api(`/projects/${projectId}/section-workspaces/${sectionKey}/correct`, {
        method: 'POST',
        token,
        body: JSON.stringify({}),
      });
      await load();
    } catch (err) {
      setError(errText(err, 'Не удалось создать корректировку'));
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleHistory(sectionKey: SectionKey) {
    if (details[sectionKey]) {
      setDetails((current) => {
        const next = { ...current };
        delete next[sectionKey];
        return next;
      });
      return;
    }
    setBusyKey(sectionKey);
    try {
      const data = await api<WorkspaceDetails>(
        `/projects/${projectId}/section-workspaces/${sectionKey}`,
        { token },
      );
      setDetails((current) => ({ ...current, [sectionKey]: data }));
    } catch (err) {
      setError(errText(err, 'Не удалось загрузить историю раздела'));
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Загрузка версий разделов…
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-[#28282D]">Черновики и версии разделов</h2>
          <p className="mt-1 text-sm text-gray-500">
            Сохранение обновляет черновик. Фиксация создаёт неизменяемую версию.
          </p>
        </div>
        <button onClick={() => void load()} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#00823C]">
          <RefreshCw className="h-4 w-4" /> Обновить
        </button>
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="divide-y divide-gray-100">
        {localSections.map((section) => {
          const row = rows.find((item) => item.sectionKey === section.key);
          const freshness = row?.freshness ?? 'missing';
          const history = details[section.key];
          return (
            <div key={section.key} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  {/* Правки v3: строка статуса ведёт прямо к форме раздела. */}
                  <a href={`#section-${section.key}`}
                    className="text-sm font-medium text-[#28282D] underline-offset-4 hover:text-[#00823C] hover:underline">
                    {section.letter} — {section.title}
                  </a>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
                    {freshness === 'fresh' ? (
                      <><CheckCircle2 className="h-3.5 w-3.5 text-[#00823C]" /> Версия {row?.currentRevision?.version} зафиксирована</>
                    ) : freshness === 'stale' ? (
                      <><Clock3 className="h-3.5 w-3.5 text-amber-600" /> Есть незафиксированные изменения</>
                    ) : (
                      <><a href={`#section-${section.key}`} className="hover:text-[#00823C] hover:underline">Данные ещё не сохранены — заполнить раздел</a></>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {row?.currentRevision && (
                    <button onClick={() => void toggleHistory(section.key)} disabled={busyKey === section.key}
                      className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:border-[#00823C] hover:text-[#00823C] disabled:opacity-50">
                      <History className="h-3.5 w-3.5" /> История
                    </button>
                  )}
                  {canManageVersions && freshness === 'stale' && (
                    <button onClick={() => void fix(section.key)} disabled={busyKey === section.key}
                      className="rounded-lg bg-[#00823C] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#006e33] disabled:opacity-50">
                      {busyKey === section.key ? 'Фиксация…' : 'Зафиксировать'}
                    </button>
                  )}
                  {canManageVersions && freshness === 'fresh' && (
                    <button onClick={() => void correct(section.key)} disabled={busyKey === section.key}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-[#00823C] hover:text-[#00823C] disabled:opacity-50">
                      Создать корректировку
                    </button>
                  )}
                </div>
              </div>

              {history && (
                <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  {history.revisions.map((revision) => (
                    <p key={revision.id} className="py-0.5">
                      v{revision.version} · {new Date(revision.fixedAt).toLocaleString('ru-RU')} · {revision.fixedBy}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isEmployeeLink && (
        <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
          Вы можете заполнять назначенные разделы. Фиксацию выполняет руководитель.
        </p>
      )}
    </section>
  );
}
