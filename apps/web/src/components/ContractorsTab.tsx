'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Phone, Plus, Trash2, User, X } from 'lucide-react';
import { api, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { maskPhone, unmaskPhone } from '@/lib/format';
import { useConfirm } from '@/components/ConfirmDialog';
import type { Contractor } from '@/lib/types';
import { useAccess } from '@/stores/access';

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-[#28282D] outline-none transition focus:border-[#00823C] focus:ring-2 focus:ring-[#00823C]/20';

export function ContractorsTab({ projectId }: { projectId: string }) {
  const token = useAuth((s) => s.token);
  const confirm = useConfirm();
  const canEdit = useAccess((s) => s.who?.kind !== 'link');

  const [items, setItems] = useState<Contractor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Contractor | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api<Contractor[]>(`/projects/${projectId}/contractors`, { token }));
    } catch (err) {
      setError(errText(err, 'Не удалось загрузить подрядчиков'));
    } finally {
      setLoading(false);
    }
  }, [projectId, token]);

  useEffect(() => { load(); }, [load]);

  async function remove(c: Contractor) {
    const ok = await confirm({
      message: `Удалить подрядчика «${c.name}»?`,
      description: 'Если за подрядчиком закреплены разделы или работы — удаление будет отклонено.',
      confirmText: 'Удалить',
    });
    if (!ok) return;
    try {
      await api(`/contractors/${c.id}`, { method: 'DELETE', token });
      load();
    } catch (err) {
      setError(errText(err, 'Не удалось удалить подрядчика'));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загрузка…
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-[#28282D]">Подрядчики</h3>
        {canEdit && <button onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-lg bg-[#00823C] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#006e33]">
          <Plus className="h-4 w-4" /> Добавить подрядчика
        </button>}
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {items.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white py-16 text-center text-gray-400">
          Подрядчиков пока нет
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <div key={c.id} className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-semibold text-[#28282D]">{c.name}</h4>
                {canEdit && <div className="flex gap-1">
                  <button onClick={() => setEditing(c)}
                    className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-[#00823C]">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => remove(c)}
                    className="rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>}
              </div>
              <div className="mt-2 space-y-1 text-sm text-gray-500">
                <p className="flex items-center gap-1.5">
                  <User className="h-4 w-4 shrink-0" /> {c.contactPerson || '—'}
                </p>
                <p className="flex items-center gap-1.5">
                  <Phone className="h-4 w-4 shrink-0" />
                  {/* ПР-3.1: телефон всегда в едином формате */}
                  {c.phone ? maskPhone(c.phone) : '—'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ContractorModal
          projectId={projectId}
          contractor={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function ContractorModal({
  projectId, contractor, onClose, onSaved,
}: {
  projectId: string;
  contractor: Contractor | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const token = useAuth((s) => s.token);
  const [name, setName] = useState(contractor?.name ?? '');
  const [contactPerson, setContactPerson] = useState(contractor?.contactPerson ?? '');
  // ПР-3.1: в поле показываем маску, на бэк шлём только цифры
  const [phone, setPhone] = useState(contractor?.phone ? maskPhone(contractor.phone) : '');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const digits = unmaskPhone(phone);
  const phoneInvalid = phone.length > 0 && digits.length !== 11;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (phoneInvalid) {
      setErr('Телефон должен содержать 11 цифр: +7 XXX XXX-XX-XX');
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name: name.trim() };
      if (contactPerson.trim()) body.contactPerson = contactPerson.trim();
      if (digits) body.phone = digits;

      if (contractor) {
        await api(`/contractors/${contractor.id}`, { method: 'PATCH', token, body: JSON.stringify(body) });
      } else {
        await api(`/projects/${projectId}/contractors`, { method: 'POST', token, body: JSON.stringify(body) });
      }
      onSaved();
    } catch (e2) {
      setErr(errText(e2, 'Не удалось сохранить подрядчика'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h3 className="text-lg font-bold text-[#28282D]">
            {contractor ? 'Редактировать подрядчика' : 'Новый подрядчик'}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 p-6">
          {err && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

          <div>
            <label className="mb-1 block text-sm font-medium text-[#28282D]">
              Наименование <span className="text-red-500">*</span>
            </label>
            <input value={name} onChange={(e) => setName(e.target.value)} required
              placeholder="ООО «СтройМонтаж»" className={inputCls} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-[#28282D]">Контактное лицо</label>
            <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)}
              placeholder="Иванов И.И." maxLength={100} className={inputCls} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-[#28282D]">Телефон</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value ? maskPhone(e.target.value) : '')}
              inputMode="tel"
              placeholder="+7 923 182-00-17"
              maxLength={18}
              className={`${inputCls} ${phoneInvalid ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''}`}
            />
            <p className={`mt-1 text-xs ${phoneInvalid ? 'text-red-600' : 'text-gray-400'}`}>
              {phoneInvalid
                ? `Введено ${digits.length} из 11 цифр`
                : 'Вводите только цифры — формат подставится автоматически'}
            </p>
          </div>

          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button type="button" onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">
              Отмена
            </button>
            <button type="submit" disabled={saving || phoneInvalid}
              className="flex items-center gap-2 rounded-lg bg-[#00823C] px-5 py-2 text-sm font-medium text-white hover:bg-[#006e33] disabled:opacity-60">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
