'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2, X } from 'lucide-react';

export interface SectionFillStatus {
  key: string;
  label: string;
  filled: boolean;
  /** ПР-1.5: кто и когда последним сохранял секцию */
  editor?: { name: string; role: string; at: string } | null;
  /** Актуальность локальной версии: stale блокирует выпуск выбранной секции. */
  freshness?: 'missing' | 'fresh' | 'stale';
  version?: number | null;
}

/** ПР-5.1 + К4: чекбоксы «выводить/не выводить» + предупреждение о пустых */
export function FinalizeDialog({
  statuses, busy, onCancel, onConfirm,
}: {
  statuses: SectionFillStatus[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (enabledSections: string[]) => void;
}) {
  // По умолчанию включены все секции
  const [enabled, setEnabled] = useState<Set<string>>(
    () => new Set(statuses.map((s) => s.key)),
  );

  const toggle = (key: string) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // Предупреждаем только о тех пустых, которые ВЫВОДЯТСЯ в отчёт
  const emptyShown = statuses.filter((s) => !s.filled && enabled.has(s.key));
  const unfixedShown = statuses.filter((s) => s.freshness === 'stale' && enabled.has(s.key));
  const hiddenCount = statuses.length - enabled.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <h3 className="text-lg font-bold text-[#28282D]">Сформировать отчёт</h3>
          <button onClick={onCancel} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <p className="text-sm text-gray-500">
            Отметьте секции, которые войдут в финальный отчёт.
            Отключённая секция не выводится только в этом отчёте — в следующем её можно включить снова.
          </p>

          <div className="overflow-hidden rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="w-16 px-3 py-2">Вывод</th>
                  <th className="px-3 py-2">Секция</th>
                  <th className="w-28 px-3 py-2">Версия</th>
                  <th className="px-3 py-2">Кто заполнил</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {statuses.map((s) => {
                  const on = enabled.has(s.key);
                  return (
                    <tr key={s.key} className={on ? '' : 'bg-gray-50/70 opacity-60'}>
                      <td className="px-3 py-2">
                        <button onClick={() => toggle(s.key)} title={on ? 'Выводить' : 'Не выводить'}
                          className={`flex items-center gap-1 rounded-lg px-2 py-1 transition ${
                            on ? 'text-[#00823C] hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'
                          }`}>
                          {on ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <span className={on ? 'text-[#28282D]' : 'text-gray-400 line-through'}>
                          {s.label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {s.freshness === 'stale' ? (
                          <span className="text-xs font-medium text-red-600">не зафиксирована</span>
                        ) : s.version ? (
                          <span className="inline-flex items-center gap-1 text-xs text-[#00823C]">
                            <CheckCircle2 className="h-3.5 w-3.5" /> v{s.version}
                          </span>
                        ) : s.filled ? (
                          <span className="inline-flex items-center gap-1 text-xs text-[#00823C]">
                            <CheckCircle2 className="h-3.5 w-3.5" /> заполнена
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">пусто</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {s.editor ? (
                          <div className="text-xs">
                            <p className="font-medium text-[#28282D]">{s.editor.name}</p>
                            <p className="text-gray-400">
                              {new Date(s.editor.at).toLocaleString('ru-RU', {
                                day: '2-digit', month: '2-digit',
                                hour: '2-digit', minute: '2-digit',
                              })}
                            </p>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {unfixedShown.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Сначала зафиксируйте изменения разделов: <b>{unfixedShown.map((s) => s.label).join(', ')}</b>.
            </div>
          )}

          {emptyShown.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <p className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Секции <b>[{emptyShown.map((e) => e.key).join(', ')}]</b> не заполнены.
                  Отчёт будет сформирован с пустыми блоками. Продолжить?
                </span>
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-[#00823C]">
              Все выводимые секции заполнены — отчёт будет сформирован полностью.
            </div>
          )}

          {hiddenCount > 0 && (
            <p className="text-xs text-gray-500">
              Не будет выведено секций: <b>{hiddenCount}</b>
            </p>
          )}

          <p className="text-xs text-gray-400">
            После формирования данные недели блокируются (только просмотр).
          </p>

          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button onClick={onCancel}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">
              Вернуться
            </button>
            <button onClick={() => onConfirm([...enabled])} disabled={busy || unfixedShown.length > 0}
              className="flex items-center gap-2 rounded-lg bg-[#00823C] px-5 py-2 text-sm font-medium text-white hover:bg-[#006e33] disabled:opacity-60">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Да, сформировать
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
