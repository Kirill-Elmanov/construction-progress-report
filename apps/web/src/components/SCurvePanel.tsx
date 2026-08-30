'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';

interface Scope { id: string; name: string; code: string | null; overall: boolean; depth?: number }
interface Point {
  date: string; label: string;
  plan: number | null; fact: number | null; forecast: number | null;
}
interface CurveResponse {
  automationConfigured: boolean;
  scopes: Scope[];
  selectedScope: string;
  asOfDate: string;
  syncedAt: string | null;
  points: Point[];
}

export function SCurvePanel({ projectId, canRefresh }: { projectId: string; canRefresh: boolean }) {
  const token = useAuth((state) => state.token);
  const [data, setData] = useState<CurveResponse | null>(null);
  const [scope, setScope] = useState('__project__');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (selected: string) => {
    setLoading(true); setError(null);
    try {
      const result = await api<CurveResponse>(
        `/projects/${projectId}/s-curve?scope=${encodeURIComponent(selected)}`, { token },
      );
      setData(result); setScope(result.selectedScope);
    } catch (loadError) {
      setError(errText(loadError, 'Не удалось загрузить S-кривую'));
    } finally { setLoading(false); }
  }, [projectId, token]);

  useEffect(() => { void load('__project__'); }, [load]);

  async function refresh() {
    setRefreshing(true); setError(null);
    try {
      await api(`/projects/${projectId}/schedule/refresh`, { method: 'POST', token });
      await load(scope);
    } catch (refreshError) {
      setError(errText(refreshError, 'Не удалось актуализировать данные PLAN-R'));
    } finally { setRefreshing(false); }
  }

  if (loading && !data) return <div className="flex justify-center py-16 text-gray-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загрузка…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-[#28282D]">S-кривая выполнения · план / факт / прогноз</h3>
          <p className="text-xs text-gray-400">
            Дата отчёта: {data?.asOfDate ? new Date(data.asOfDate).toLocaleDateString('ru-RU') : '—'}
            {data?.syncedAt ? ` · PLAN-R обновлён ${new Date(data.syncedAt).toLocaleString('ru-RU')}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(data?.scopes.length ?? 0) > 1 && (
            <select value={scope} onChange={(event) => { setScope(event.target.value); void load(event.target.value); }}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              {data?.scopes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.overall ? '' : `${'— '.repeat(item.depth ?? 0)}`}
                  {item.code ? `${item.code} · ` : ''}{item.name}
                </option>
              ))}
            </select>
          )}
          {canRefresh && (
            <button onClick={refresh} disabled={refreshing || !data?.automationConfigured}
              title={!data?.automationConfigured ? 'Заполните параметры PLAN-R в карточке проекта и токен в .env' : undefined}
              className="flex items-center gap-1.5 rounded-lg bg-[#00823C] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Актуализировать данные
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {!data?.automationConfigured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Интеграция ещё не активна: супер‑администратору нужно заполнить EPS ID и UUID целевых дат, а токен — в файле <b>.env</b>.
        </div>
      )}

      {!data?.points.length ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white py-16 text-center text-gray-400">
          Данных пока нет. После настройки нажмите «Актуализировать данные».
        </div>
      ) : (
        <div className="h-[390px] rounded-2xl border border-gray-200 bg-white p-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.points} margin={{ top: 10, right: 24, bottom: 10, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F2" />
              <XAxis dataKey="label" minTickGap={28} tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => [`${value}%`, '']} />
              <Legend />
              <Line type="monotone" dataKey="plan" name="План" stroke="#9CA3AF" strokeWidth={2.5} dot={false} connectNulls />
              <Line type="monotone" dataKey="fact" name="Факт" stroke="#00823C" strokeWidth={3} dot={{ r: 4 }} connectNulls />
              <Line type="monotone" dataKey="forecast" name="Прогноз" stroke="#00823C" strokeWidth={2.5}
                strokeDasharray="7 5" dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
