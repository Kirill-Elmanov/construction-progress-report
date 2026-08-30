'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { api, errText } from '@/lib/api';
import { getSectionMeta, type WhoAmI } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { useAccess } from '@/stores/access';

/** ПР-1.5: вход специалиста по ссылке-доступу (без логина и пароля) */
export default function AccessPage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState<WhoAmI | null>(null);

  useEffect(() => {
    const t = params.token;
    if (!t) return;

    // Правки v4: ссылка специалиста явно переключает режим авторизации.
    // Иначе сохранённый JWT руководителя имел приоритет на странице проекта.
    useAuth.getState().logout();
    useAccess.getState().clear();
    localStorage.setItem('rost_access_token', t);

    api<WhoAmI>('/access-links/whoami', {})
      .then((w) => {
        setWho(w);
        setTimeout(() => {
          // С одним назначением сразу открываем проект, с несколькими — список.
          router.replace(w.projects.length === 1 ? `/projects/${w.projects[0].projectId}` : '/projects');
        }, 1200);
      })
      .catch((err) => {
        localStorage.removeItem('rost_access_token');
        setError(errText(err, 'Ссылка недействительна или отозвана'));
      });
  }, [params.token, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F2FAE3] p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl">
        {error ? (
          <>
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-red-500" />
            <h1 className="mb-2 text-lg font-bold text-[#28282D]">Доступ не получен</h1>
            <p className="mb-5 text-sm text-gray-500">{error}</p>
            <button onClick={() => router.push('/login')}
              className="rounded-lg bg-[#00823C] px-5 py-2 text-sm font-medium text-white hover:bg-[#006e33]">
              Войти по логину
            </button>
          </>
        ) : who ? (
          <>
            <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-[#00823C]" />
            <h1 className="mb-1 text-lg font-bold text-[#28282D]">{who.name}</h1>
            <p className="mb-4 text-sm text-gray-500">Доступ подтверждён</p>
            <div className="mb-4 space-y-2 text-left">
              {who.projects.map((project) => (
                <div key={project.projectId} className="rounded-lg bg-[#00823C]/5 px-3 py-2">
                  <p className="text-sm font-medium text-[#28282D]">{project.projectName}</p>
                  <p className="mt-1 text-xs text-[#00823C]">
                    {project.allowedSections.length > 0
                      ? `Разделы: ${project.allowedSections
                          .map((section) => getSectionMeta(section)?.letter ?? section)
                          .join(', ')}`
                      : 'Только просмотр'}
                  </p>
                </div>
              ))}
            </div>
            <p className="flex items-center justify-center gap-2 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Открываем проект…
            </p>
          </>
        ) : (
          <p className="flex items-center justify-center gap-2 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" /> Проверяем ссылку…
          </p>
        )}
      </div>
    </div>
  );
}
