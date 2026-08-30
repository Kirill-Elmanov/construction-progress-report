'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/stores/auth';
import { useAccess } from '@/stores/access';

// ПР-1.5 / Этап 1: защищённые страницы принимают и JWT сотрудника,
// и персональную ссылку-доступ. Оба способа проходят одну проверку API.
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const token = useAuth((s) => s.token);
  const checkAccess = useAccess((s) => s.check);
  const [checked, setChecked] = useState(false);
  // Правки v3: при перезагрузке Zustand сначала восстанавливает JWT из
  // localStorage. До завершения гидратации token временно равен null, поэтому
  // прежняя проверка успевала ошибочно отправить руководителя на страницу входа.
  const [authHydrated, setAuthHydrated] = useState(false);

  useEffect(() => {
    // Эффект выполняется только в браузере — к этому моменту persist уже успел
    // прочитать синхронный localStorage. Это также не ломает статическую сборку.
    setAuthHydrated(true);
  }, []);

  useEffect(() => {
    // Не принимаем решение об авторизации по ещё не восстановленному стору.
    if (!authHydrated) return;

    let cancelled = false;

    // JWT уже проверяется каждым запросом API.
    if (token) {
      setChecked(true);
      return () => { cancelled = true; };
    }
    setChecked(false);

    // Без JWT пробуем токен из персональной ссылки.
    const accessToken = localStorage.getItem('rost_access_token');
    if (!accessToken) {
      router.replace('/login');
      return () => { cancelled = true; };
    }

    checkAccess().then(() => {
      if (cancelled) return;
      if (useAccess.getState().who) setChecked(true);
      else router.replace('/login');
    });

    return () => { cancelled = true; };
  }, [authHydrated, token, router, checkAccess]);

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F2FAE3]">
        <div className="text-gray-400">Загрузка…</div>
      </div>
    );
  }

  return <>{children}</>;
}
