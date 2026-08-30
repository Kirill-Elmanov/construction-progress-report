'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Loader2, Lock, Mail } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useAccess } from '@/stores/access';
import type { LoginResponse } from '@/lib/types';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuth((s) => s.setAuth);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // POST /auth/login → { token, user } (точно по бэку)
      const res = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      // Вход руководителя, наоборот, завершает возможную сессию по ссылке.
      useAccess.getState().clear();

      // user приходит сразу — сохраняем в стор
      setAuth(res.token, {
        id: res.user.id,
        email: res.user.email,
        role: res.user.role,
        displayName: res.user.displayName,
        fullName: (res.user as any).fullName,  // ПР-1.3: ФИО из Google-справочника
        mustChangePassword: res.user.mustChangePassword,
      });
      
      // Обязательная смена пароля (ТЗ 4.6)
      if (res.user.mustChangePassword) {
        router.push('/change-password');
      } else {
        router.push('/projects');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        // Бэк на 401 шлёт "Неверный email или пароль" — покажем как есть
        setError(err.message);
      } else {
        setError('Не удалось подключиться к серверу');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F2FAE3] px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#00823C]">
            <Building2 className="h-9 w-9 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-[#28282D]">РОСТ-Отчёт</h1>
          <p className="mt-1 text-sm text-gray-500">Вход для администраторов</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-8 shadow-lg">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-[#28282D]">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-3 text-[#28282D] outline-none transition focus:border-[#00823C] focus:ring-2 focus:ring-[#00823C]/20"
              />
            </div>
          </div>

          <div className="mb-6">
            <label className="mb-1.5 block text-sm font-medium text-[#28282D]">Пароль</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                type="password" required value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Пароль"
                className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-3 text-[#28282D] outline-none transition focus:border-[#00823C] focus:ring-2 focus:ring-[#00823C]/20"
              />
            </div>
          </div>

          <button
            type="submit" disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#00823C] py-2.5 font-medium text-white transition hover:bg-[#006e33] disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? 'Вход…' : 'Войти'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-400">
          Исполнители входят по ссылке-доступу
        </p>
      </div>
    </div>
  );
}
