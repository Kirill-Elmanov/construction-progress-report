'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, BarChart3, Building2, Loader2, Pencil, Trash2 } from 'lucide-react';
import { api, ApiError, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { CAN_CREATE_PROJECT, CAN_EDIT_PROJECT } from '@/lib/types';
import type { Project } from '@/lib/types';
import { AuthGuard } from '@/components/AuthGuard';
import { SectionsTab } from '@/components/SectionsTab';
import { ContractorsTab } from '@/components/ContractorsTab';
import { ReportsTab } from '@/components/ReportsTab';
import { ReportSectionsTab } from '@/components/ReportSectionsTab';
import { EditProjectModal } from '@/components/EditProjectModal';
import { ProjectInfoPanel } from '@/components/ProjectInfoPanel';
import { DeleteProjectDialog } from '@/components/DeleteProjectDialog';
import { CAN_USE_TRASH } from '@/lib/types';

type Tab = 'sections' | 'contractors' | 'reportSections' | 'reports';

function ProjectContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('sections');
  const [deleting, setDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const isGlobalAdmin = Boolean(user?.role && CAN_CREATE_PROJECT.includes(user.role));
  const canEdit = Boolean(user?.role && CAN_EDIT_PROJECT.includes(user.role));
  const isSuperadmin = Boolean(user?.role && CAN_USE_TRASH.includes(user.role));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await api<Project>(`/projects/${id}`, { token });
      setProject(p);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setError(errText(err, 'Не удалось загрузить проект'));
    } finally {
      setLoading(false);
    }
  }, [id, token, router]);

  useEffect(() => { load(); }, [load]);

  // Правки v3: выбранная вкладка хранится в URL и не исчезает после обновления.
  useEffect(() => {
    const requested = searchParams.get('tab');
    if (requested === 'schedule') {
      // Правки v6: старые ссылки на вкладку графика ведём в разделы отчёта.
      setTab('reportSections');
    } else if (requested && ['sections', 'contractors', 'reportSections', 'reports'].includes(requested)) {
      setTab(requested as Tab);
    }
  }, [searchParams]);

  async function handleDelete(mode: 'trash' | 'permanent') {
    setDeleting(true);
    try {
      await api(`/projects/${id}?mode=${mode}`, { method: 'DELETE', token });
      router.replace('/projects');
    } catch (err) {
      setDeleteOpen(false);
      setError(errText(err, 'Не удалось удалить проект'));
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F2FAE3] text-gray-400">
        <Loader2 className="mr-2 h-6 w-6 animate-spin" /> Загрузка проекта…
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F2FAE3]">
        <p className="text-red-600">{error ?? 'Проект не найден'}</p>
        <button onClick={() => router.push('/projects')}
          className="rounded-lg bg-[#00823C] px-4 py-2 text-white">
          К списку проектов
        </button>
      </div>
    );
  }

  // Правки v3: все рабочие вкладки видны каждому пользователю.
  // Права определяют возможность редактирования внутри вкладки, а не её видимость.
  const tabs: { key: Tab; label: string }[] = [
    { key: 'sections', label: 'Выполняемые работы' },
    { key: 'contractors', label: 'Подрядчики' },
    { key: 'reportSections', label: 'Разделы отчёта' },
    { key: 'reports', label: 'Отчёты' },
  ];
  const activeTab = tab;

  function selectTab(next: Tab) {
    setTab(next);
    router.replace(`/projects/${id}?tab=${next}`, { scroll: false });
  }

  return (
    <div className="min-h-screen bg-[#F2FAE3]">
      {/* Шапка */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <button onClick={() => router.push('/projects')}
            className="mb-3 flex items-center gap-1.5 text-sm text-gray-500 transition hover:text-[#00823C]">
            <ArrowLeft className="h-4 w-4" /> Все проекты
          </button>

          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#00823C]">
                <Building2 className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-[#28282D]">{project.name}</h1>
                <p className="text-sm text-gray-500">{project.address}</p>
              </div>
            </div>

            <div className="flex shrink-0 gap-2">
              <button onClick={() => router.push(`/projects/${project.id}/dashboard`)}
                className="flex items-center gap-1.5 rounded-lg bg-[#00823C] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#006e33]">
                <BarChart3 className="h-4 w-4" />
                Дашборд
              </button>
              {canEdit && (
                <button onClick={() => setEditOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-[#28282D] transition hover:border-[#00823C] hover:text-[#00823C]">
                  <Pencil className="h-4 w-4" />
                  Редактировать
                </button>
              )}
              {isGlobalAdmin && (
                <button onClick={() => setDeleteOpen(true)} disabled={deleting}
                  className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-60">
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Удалить
                </button>
              )}
            </div>
          </div>

          {/* ПР-2.2: информация об объекте по блокам */}
          <ProjectInfoPanel project={project} />
        </div>

        {/* Вкладки */}
        <div className="mx-auto max-w-6xl overflow-x-auto px-6">
          <nav className="flex min-w-max gap-1">
            {tabs.map((t) => (
              <button key={t.key} onClick={() => selectTab(t.key)}
                className={`-mb-px border-b-2 px-4 py-3 text-sm font-medium transition ${
                  activeTab === t.key
                    ? 'border-[#00823C] text-[#00823C]'
                    : 'border-transparent text-gray-500 hover:text-[#28282D]'
                }`}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {activeTab === 'sections' && <SectionsTab projectId={project.id} />}
        {activeTab === 'contractors' && <ContractorsTab projectId={project.id} />}
        {activeTab === 'reportSections' && <ReportSectionsTab projectId={project.id} />}
        {activeTab === 'reports' && <ReportsTab projectId={project.id} />}
      </main>

      {deleteOpen && (
        isSuperadmin ? (
          <DeleteProjectDialog
            projectName={project.name}
            onClose={() => setDeleteOpen(false)}
            onConfirm={handleDelete}
          />
        ) : (
          <DeleteProjectDialog
            projectName={project.name}
            onClose={() => setDeleteOpen(false)}
            onConfirm={() => handleDelete('permanent')}
            onlyPermanent
          />
        )
      )}

      {editOpen && (
        <EditProjectModal
          project={project}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); load(); }}
        />
      )}
    </div>
  );
}

export default function ProjectPage() {
  return (
    <AuthGuard>
      <ProjectContent />
    </AuthGuard>
  );
}
