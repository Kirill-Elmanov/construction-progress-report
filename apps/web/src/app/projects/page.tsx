'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Plus, MapPin, Calendar, Loader2, Archive, KeyRound, Users } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { CAN_CREATE_PROJECT, CAN_MANAGE_ACCESS, CAN_USE_TRASH } from '@/lib/types';
import { UserBadge } from '@/components/UserBadge';
import type { Project } from '@/lib/types';
import { AuthGuard } from '@/components/AuthGuard';
import { CreateProjectModal } from '@/components/CreateProjectModal';
import { AccessLinksTab } from '@/components/AccessLinksTab';

function ProjectsContent() {
  const router = useRouter();
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showAccess, setShowAccess] = useState(false);

  const canCreate = Boolean(
    user?.role && CAN_CREATE_PROJECT?.includes(user.role)
  );

  const canTrash = Boolean(user?.role && CAN_USE_TRASH.includes(user.role));
  const canManageAccess = Boolean(user?.role && CAN_MANAGE_ACCESS.includes(user.role));

  async function loadProjects() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<Project[]>('/projects', { token });
      setProjects(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        router.replace('/login');
      } else {
        setError('Не удалось загрузить проекты');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLogout() {
    logout();
    router.replace('/login');
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  }

  function formatMoney(n: number) {
    return new Intl.NumberFormat('ru-RU').format(n) + ' ₽';
  }

  return (
    <div className="min-h-screen bg-[#F2FAE3]">
      {/* Шапка */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00823C]">
              <Building2 className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#28282D]">РОСТ-Отчёт</h1>
              <p className="text-xs text-gray-500">Проекты</p>
            </div>
          </div>

          <UserBadge />
        </div>
      </header>

      {/* Контент */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* На телефоне действия переносятся ниже заголовка и не расширяют страницу. */}
        <div className="mb-6 flex flex-col gap-4 tablet:flex-row tablet:items-center tablet:justify-between">
          <h2 className="text-2xl font-bold text-[#28282D]">
            {showAccess ? 'Доступы специалистов' : 'Мои проекты'}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
          {canManageAccess && (
            <button onClick={() => setShowAccess((value) => !value)}
              className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-[#28282D] hover:border-[#00823C] hover:text-[#00823C]">
              <KeyRound className="h-4 w-4" /> {showAccess ? 'К проектам' : 'Доступы специалистов'}
            </button>
          )}
          {user?.role === 'superadmin' && (
            <button onClick={() => router.push('/users')} className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-[#28282D] hover:border-[#00823C] hover:text-[#00823C]">
              <Users className="h-4 w-4" /> Руководители
            </button>
          )}
          {canTrash && (
            <button
              onClick={() => router.push('/projects/trash')}
              className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-[#28282D] transition hover:border-[#00823C] hover:text-[#00823C]"
            >
              <Archive className="h-4 w-4" />
              Корзина
            </button>
          )}
          {canCreate && (
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 rounded-lg bg-[#00823C] px-4 py-2.5 font-medium text-white transition hover:bg-[#006e33]"
            >
              <Plus className="h-5 w-5" />
              Создать проект
            </button>
          )}
          </div>
        </div>

        {showAccess ? (
          <AccessLinksTab />
        ) : <>
        {loading && (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <Loader2 className="mr-2 h-6 w-6 animate-spin" />
            Загрузка проектов…
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</div>
        )}

        {!loading && !error && projects.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white py-20 text-center">
            <Building2 className="mx-auto mb-4 h-12 w-12 text-gray-300" />
            <p className="text-gray-500">Пока нет проектов</p>
            {canCreate && (
              <p className="mt-1 text-sm text-gray-400">
                Нажмите «Создать проект», чтобы добавить первый
              </p>
            )}
          </div>
        )}

        {!loading && !error && projects.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => router.push(`/projects/${p.id}`)}
                className="group rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-[#00823C] hover:shadow-md"
              >
                <h3 className="mb-2 font-semibold text-[#28282D] group-hover:text-[#00823C]">
                  {p.name}
                </h3>
                <div className="space-y-1.5 text-sm text-gray-500">
                  <p className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 shrink-0" />
                    <span className="line-clamp-1">{p.address}</span>
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Calendar className="h-4 w-4 shrink-0" />
                    {formatDate(p.planStart)} — {formatDate(p.planFinish)}
                  </p>
                </div>
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <p className="text-sm font-medium text-[#00823C]">
                    {formatMoney(p.budget)}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">{p.customer}</p>
                </div>
              </button>
            ))}
          </div>
        )}
        </>}
      </main>

      {/* Модалка создания */}
      {showModal && (
        <CreateProjectModal
          onClose={() => setShowModal(false)}
          onCreated={() => {
            setShowModal(false);
            loadProjects();
          }}
        />
      )}
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <AuthGuard>
      <ProjectsContent />
    </AuthGuard>
  );
}
