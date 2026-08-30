'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';

export interface ConfirmOptions {
  /** Текст вопроса — основная строка */
  message: string;
  /** Дополнительное пояснение под вопросом */
  description?: string;
  /** Надпись на кнопке подтверждения */
  confirmText?: string;
  /** Надпись на кнопке отмены */
  cancelText?: string;
  /** danger — красная кнопка (удаление), normal — зелёная */
  tone?: 'danger' | 'normal';
}

type Resolver = (ok: boolean) => void;

const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<boolean>>(
  async () => false,
);

/** ПР-7.1: заменяет браузерный confirm(). Диалог по центру, без localhost в заголовке. */
export function useConfirm() {
  return useContext(ConfirmCtx);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [resolver, setResolver] = useState<{ fn: Resolver } | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => setResolver({ fn: resolve }));
  }, []);

  function close(ok: boolean) {
    resolver?.fn(ok);
    setResolver(null);
    setOpts(null);
  }

  const danger = opts?.tone !== 'normal';

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}

      {opts && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          onClick={() => close(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h3 className="text-lg font-bold text-[#28282D]">Подтвердите действие</h3>
              <button
                onClick={() => close(false)}
                className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-5">
              <div className="flex gap-3">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                    danger ? 'bg-red-50 text-red-600' : 'bg-[#00823C]/10 text-[#00823C]'
                  }`}
                >
                  {danger ? <Trash2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                </div>
                <div className="pt-0.5">
                  <p className="text-sm font-medium text-[#28282D]">{opts.message}</p>
                  {opts.description && (
                    <p className="mt-1 text-sm text-gray-500">{opts.description}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
              <button
                onClick={() => close(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
              >
                {opts.cancelText ?? 'Отмена'}
              </button>
              <button
                onClick={() => close(true)}
                autoFocus
                className={`rounded-lg px-5 py-2 text-sm font-medium text-white transition ${
                  danger ? 'bg-red-600 hover:bg-red-700' : 'bg-[#00823C] hover:bg-[#006e33]'
                }`}
              >
                {opts.confirmText ?? 'Подтвердить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}