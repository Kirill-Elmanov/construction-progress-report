'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Building2, CheckCircle2, Loader2, Lock } from 'lucide-react';
import { api, errText } from '@/lib/api';

export default function ActivatePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [person, setPerson] = useState<{ email: string; displayName: string } | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api<{ email: string; displayName: string }>(`/auth/activate/${token}`)
      .then(setPerson)
      .catch((err) => setError(errText(err, 'Ссылка активации недействительна')))
      .finally(() => setLoading(false));
  }, [token]);

  async function activate(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) { setError('Пароли не совпадают'); return; }
    setSaving(true);
    setError(null);
    try {
      await api(`/auth/activate/${token}`, {
        method: 'POST', body: JSON.stringify({ password }),
      });
      setDone(true);
    } catch (err) {
      setError(errText(err, 'Не удалось активировать учётную запись'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F2FAE3] px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#00823C]">
            <Building2 className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-xl font-bold text-[#28282D]">Активация учётной записи</h1>
        </div>

        {loading && <p className="flex justify-center gap-2 text-gray-500"><Loader2 className="animate-spin" /> Проверка ссылки…</p>}
        {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {done ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-[#00823C]" />
            <p className="font-medium text-[#28282D]">Пароль успешно установлен</p>
            <button onClick={() => router.push('/login')} className="mt-5 rounded-lg bg-[#00823C] px-5 py-2.5 text-white">Перейти ко входу</button>
          </div>
        ) : person && (
          <form onSubmit={activate}>
            <p className="mb-5 text-sm text-gray-600">
              Здравствуйте, <b>{person.displayName}</b>. Задайте пароль для входа под email <b>{person.email}</b>.
            </p>
            <label className="mb-1 block text-sm font-medium">Пароль</label>
            <div className="relative mb-4">
              <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <input type="password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 py-2.5 pl-9 pr-3 outline-none focus:border-[#00823C]" />
            </div>
            <label className="mb-1 block text-sm font-medium">Повторите пароль</label>
            <input type="password" minLength={10} required value={confirm} onChange={(e) => setConfirm(e.target.value)}
              className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:border-[#00823C]" />
            <p className="mb-5 text-xs text-gray-400">Минимум 10 символов, хотя бы одна буква и одна цифра.</p>
            <button disabled={saving} className="flex w-full justify-center gap-2 rounded-lg bg-[#00823C] py-2.5 text-white disabled:opacity-60">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Установить пароль
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
