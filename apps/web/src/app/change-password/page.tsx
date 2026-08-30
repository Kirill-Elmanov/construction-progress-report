'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2 } from 'lucide-react';
import { api, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { AuthGuard } from '@/components/AuthGuard';

function ChangePasswordContent() {
  const router = useRouter();
  const token = useAuth((state) => state.token);
  const logout = useAuth((state) => state.logout);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== confirm) { setError('Новые пароли не совпадают'); return; }
    setBusy(true); setError(null);
    try {
      await api('/auth/change-password', {
        method: 'POST', token,
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      // Сервер очищает refresh-cookie; локальный access также удаляем.
      logout();
      router.replace('/login');
    } catch (err) {
      setError(errText(err, 'Не удалось изменить пароль'));
    } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F2FAE3] px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        <KeyRound className="mx-auto mb-3 h-10 w-10 text-[#00823C]" />
        <h1 className="mb-2 text-center text-xl font-bold text-[#28282D]">Смена пароля</h1>
        <p className="mb-6 text-center text-sm text-gray-500">Перед продолжением задайте собственный безопасный пароль.</p>
        {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <label className="mb-1 block text-sm font-medium">Текущий пароль</label>
        <input required type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="mb-4 w-full rounded-lg border px-3 py-2.5" />
        <label className="mb-1 block text-sm font-medium">Новый пароль</label>
        <input required minLength={10} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="mb-4 w-full rounded-lg border px-3 py-2.5" />
        <label className="mb-1 block text-sm font-medium">Повторите новый пароль</label>
        <input required minLength={10} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mb-2 w-full rounded-lg border px-3 py-2.5" />
        <p className="mb-5 text-xs text-gray-400">Минимум 10 символов, одна буква и одна цифра.</p>
        <button disabled={busy} className="flex w-full justify-center gap-2 rounded-lg bg-[#00823C] py-2.5 text-white disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Изменить пароль
        </button>
      </form>
    </div>
  );
}

export default function ChangePasswordPage() {
  return <AuthGuard><ChangePasswordContent /></AuthGuard>;
}
