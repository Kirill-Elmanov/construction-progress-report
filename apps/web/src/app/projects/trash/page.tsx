'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, RotateCcw, Trash2, Archive } from 'lucide-react';
import { api, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { fmtDate } from '@/lib/format';
import { CAN_USE_TRASH } from '@/lib/types';
import type { Project } from '@/lib/types';
import { AuthGuard } from '@/components/AuthGuard';
import { useConfirm } from '@/components/ConfirmDialog';

type TrashProject = Project & { purgeAt: string | null };

function TrashContent() {
  const router = useRouter();
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);
  const confirm = useConfirm();

  const [items, setItems] = useState<TrashProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const allowed = Boolean(user?.role && CAN_USE_TRASH.includes(user.role));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api<TrashProject[]>('/projects/trash', { token }));
    } catch (err) {
      setError(errText(err, 'Не удалось загрузить корзину'));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { if (allowed) load(); else setLoading(false); }, [allowed, load]);

  async function restore(p: TrashProject) {
    const ok = await confirm({
      message: `Восстановить проект «${p.name}»?`,
      description: 'Проект вернётся в список со всеми отчётами и данными.',
      confirmText: 'Восстановить',
      tone: 'normal',
    });
    if (!ok) return;
    try {
      await api(`/projects/${p.id}/restore`, { method: 'POST', token });
      load();
    } catch (err) {
      setError(errText(err, 'Не удалось восстановить проект'));
    }
  }

  async function purge(p: TrashProject) {
    const ok = await confirm({
      message: `Удалить «${p.name}» навсегда?`,
      description: 'Проект, все отчёты, разделы и фото будут стёрты безвозвратно.',
      confirmText: 'Удалить навсегда',
    });
    if (!ok) return;
    try {
      await api(`/projects/${p.id}?mode=permanent`, { method: 'DELETE', token });
      load();
    } catch (err) {
      setError(errText(err, 'Не удалось удалить проект'));
    }
  }

  if (!allowed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F2FAE3]">
        <p className="text-gray-600">Корзина доступна только суперадмину</p>
        <button onClick={() => router.push('/projects')}
          className="rounded-lg bg-[#00823C] px-4 py-2 text-white">К проектам</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F2FAE3]">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <button onClick={() => router.push('/projects')}
            className="mb-3 flex items-center gap-1.5 text-sm text-gray-500 transition hover:text-[#00823C]">
            <ArrowLeft className="h-4 w-4" /> Все проекты
          </button>
          <h1 className="flex items-center gap-2 text-xl font-bold text-[#28282D]">
            <Archive className="h-5 w-5 text-gray-400" /> Корзина
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Проекты хранятся 60 дней, затем удаляются автоматически
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загрузка…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white py-16 text-center text-gray-400">
            Корзина пуста
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Проект</th>
                  <th className="w-40 px-4 py-3">Удалён</th>
                  <th className="w-44 px-4 py-3">Будет стёрт</th>
                  <th className="w-32 px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#28282D]">{p.name}</p>
                      <p className="text-xs text-gray-400">{p.address}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {p.deletedAt ? fmtDate(p.deletedAt) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {p.purgeAt ? fmtDate(p.purgeAt) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => restore(p)} title="Восстановить"
                          className="rounded-lg p-1.5 text-gray-400 transition hover:bg-green-50 hover:text-[#00823C]">
                          <RotateCcw className="h-4 w-4" />
                        </button>
                        <button onClick={() => purge(p)} title="Удалить навсегда"
                          className="rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

export default function TrashPage() {
  return (
    <AuthGuard>
      <TrashContent />
    </AuthGuard>
  );
}