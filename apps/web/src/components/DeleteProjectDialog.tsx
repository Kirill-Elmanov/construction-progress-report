'use client';

import { useState } from 'react';
import { Archive, Flame, Loader2, X } from 'lucide-react';

/** ПР-1.6: суперадмин выбирает — в корзину или навсегда */
export function DeleteProjectDialog({
  projectName, onClose, onConfirm, onlyPermanent = false,
}: {
  projectName: string;
  onClose: () => void;
  onConfirm: (mode: 'trash' | 'permanent') => Promise<void>;
  onlyPermanent?: boolean;
}) {
  const [mode, setMode] = useState<'trash' | 'permanent'>(onlyPermanent ? 'permanent' : 'trash');
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');

  const needsTyping = mode === 'permanent';
  const canSubmit = !busy && (!needsTyping || typed.trim() === 'УДАЛИТЬ');

  async function go() {
    setBusy(true);
    try { await onConfirm(mode); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h3 className="text-lg font-bold text-[#28282D]">Удаление проекта</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <p className="text-sm text-gray-600">
            Проект <b className="text-[#28282D]">«{projectName}»</b> — выберите способ удаления:
          </p>

          {!onlyPermanent && <label className={`flex cursor-pointer gap-3 rounded-xl border-2 p-4 transition ${
            mode === 'trash' ? 'border-[#00823C] bg-[#00823C]/5' : 'border-gray-200 hover:border-gray-300'
          }`}>
            <input type="radio" checked={mode === 'trash'} onChange={() => setMode('trash')}
              className="mt-1 h-4 w-4 accent-[#00823C]" />
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-[#28282D]">
                <Archive className="h-4 w-4" /> Поместить в «Корзину»
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                Проект скроется из списка. Можно восстановить со всеми данными
                в течение <b>60 дней</b>, потом удалится автоматически.
              </p>
            </div>
          </label>}

          <label className={`flex cursor-pointer gap-3 rounded-xl border-2 p-4 transition ${
            mode === 'permanent' ? 'border-red-500 bg-red-50' : 'border-gray-200 hover:border-gray-300'
          }`}>
            <input type="radio" checked={mode === 'permanent'} onChange={() => setMode('permanent')}
              className="mt-1 h-4 w-4 accent-red-600" />
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-red-700">
                <Flame className="h-4 w-4" /> Удалить навсегда
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                Проект, все отчёты, разделы, подрядчики и фото будут стёрты
                <b> безвозвратно</b>. Восстановить будет невозможно.
              </p>
            </div>
          </label>

          {needsTyping && (
            <div className="rounded-lg bg-red-50 p-3">
              <label className="mb-1 block text-xs font-medium text-red-800">
                Для подтверждения введите слово <b>УДАЛИТЬ</b>
              </label>
              <input value={typed} onChange={(e) => setTyped(e.target.value)}
                placeholder="УДАЛИТЬ"
                className="w-full rounded-lg border border-red-300 px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200" />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
          <button onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">
            Отмена
          </button>
          <button onClick={go} disabled={!canSubmit}
            className={`flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium text-white transition disabled:opacity-50 ${
              mode === 'permanent' ? 'bg-red-600 hover:bg-red-700' : 'bg-[#00823C] hover:bg-[#006e33]'
            }`}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'permanent' ? 'Удалить навсегда' : 'В корзину'}
          </button>
        </div>
      </div>
    </div>
  );
}
