'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, CalendarDays, Download, Loader2, TrendingDown, TrendingUp, Wallet,
} from 'lucide-react';
import {
  CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api, apiBlobUrl, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { fmtDate, fmtMoney } from '@/lib/format';
import { ISSUE_STATUS_LABELS, LIGHT_EMOJI } from '@/lib/types';
import type { DashboardData } from '@/lib/types';
import { AuthGuard } from '@/components/AuthGuard';

const GREEN = '#00823C';
const GRAY = '#E5E7EB';
interface PdfScope { scopeId: string; scopeName: string; scopeCode: string | null; depth: number }

function Delta({ value, suffix = '%' }: { value: number; suffix?: string }) {
  if (value === 0) return <span className="text-xs text-gray-400">без изменений</span>;
  const up = value > 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${up ? 'text-[#00823C]' : 'text-red-600'}`}>
      {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {up ? '+' : ''}{value}{suffix} за неделю
    </span>
  );
}

function DashboardContent() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  const token = useAuth((s) => s.token);

  const [data, setData] = useState<DashboardData | null>(null);
  const [weekId, setWeekId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfScopes, setPdfScopes] = useState<PdfScope[]>([]);
  const [pdfScope, setPdfScope] = useState('__project__');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (rid?: string) => {
    setLoading(true);
    setError(null);
    try {
      const q = rid ? `?reportId=${rid}` : '';
      const d = await api<DashboardData>(`/projects/${projectId}/dashboard${q}`, { token });
      setData(d);
      if (d.report) setWeekId(d.report.id);
      if (d.report?.status === 'finalized') {
        try {
          const scopes = await api<PdfScope[]>(`/reports/${d.report.id}/pdf-scopes`, { token });
          setPdfScopes(scopes);
          setPdfScope(scopes.some((item) => item.scopeId === '__project__') ? '__project__' : (scopes[0]?.scopeId ?? '__project__'));
        } catch {
          setPdfScopes([]);
        }
      } else {
        setPdfScopes([]);
      }
    } catch (err) {
      setError(errText(err, 'Не удалось загрузить дашборд'));
    } finally {
      setLoading(false);
    }
  }, [projectId, token]);

  useEffect(() => { load(); }, [load]);

  async function downloadPdf(reportId: string, weekFriday: string, version: number) {
    setPdfBusy(true); setError(null);
    try {
      const url = await apiBlobUrl(`/reports/${reportId}/pdf?scope=${encodeURIComponent(pdfScope)}`, token);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `rost-report-${weekFriday.slice(0, 10)}-v${version}.pdf`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(errText(err, 'Не удалось сформировать PDF'));
    } finally {
      setPdfBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F2FAE3] text-gray-400">
        <Loader2 className="mr-2 h-6 w-6 animate-spin" /> Загрузка дашборда…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F2FAE3]">
        <p className="text-red-600">{error ?? 'Нет данных'}</p>
        <button onClick={() => router.push(`/projects/${projectId}`)}
          className="rounded-lg bg-[#00823C] px-4 py-2 text-white">К проекту</button>
      </div>
    );
  }

  const { project, report, weeks, kpi, sections, sCurve, issues, budget, resources } = data;

  if (!report || !kpi) {
    return (
      <div className="min-h-screen bg-[#F2FAE3] p-8">
        <button onClick={() => router.push(`/projects/${projectId}`)}
          className="mb-4 flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#00823C]">
          <ArrowLeft className="h-4 w-4" /> К проекту
        </button>
        <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white py-16 text-center text-gray-400">
          Пока нет отчётов. Создайте первый отчёт — и дашборд заполнится.
        </div>
      </div>
    );
  }

  const donut = [
    { name: 'Освоено', value: budget?.spent ?? 0 },
    { name: 'Остаток', value: Math.max(0, (budget?.projectBudget ?? 0) - (budget?.spent ?? 0)) },
  ];

  return (
    <div className="min-h-screen bg-[#F2FAE3]">
      {/* ═══ БЛОК 1 — Шапка ═══ */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-5">
          <button onClick={() => router.push(`/projects/${projectId}`)}
            className="mb-3 flex items-center gap-1.5 text-sm text-gray-500 transition hover:text-[#00823C]">
            <ArrowLeft className="h-4 w-4" /> К проекту
          </button>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-[#00823C]">
                Еженедельный отчёт
              </p>
              <h1 className="text-2xl font-bold text-[#28282D]">{project.name}</h1>
              <p className="mt-0.5 text-sm text-gray-500">
                {project.address} · Неделя {report.weekNumber} · {fmtDate(report.weekFriday)}
              </p>
              <p className="text-sm text-gray-400">
                {project.customer} · {project.contractor}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-gray-400" />
              <select value={weekId}
                onChange={(e) => { setWeekId(e.target.value); load(e.target.value); }}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#00823C]">
                {weeks.map((w) => (
                  <option key={w.id} value={w.id}>
                    Неделя {w.weekNumber} · {fmtDate(w.weekFriday)}
                    {w.status === 'finalized' ? ' ✓' : ''}
                  </option>
                ))}
              </select>
              {report.status === 'finalized' && (
                <>
                  {pdfScopes.length > 1 && (
                    <select value={pdfScope} onChange={(event) => setPdfScope(event.target.value)}
                      aria-label="Объект S-кривой в PDF"
                      className="max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm">
                      {pdfScopes.map((item) => (
                        <option key={item.scopeId} value={item.scopeId}>
                          {'— '.repeat(item.depth)}{item.scopeCode ? `${item.scopeCode} · ` : ''}{item.scopeName}
                        </option>
                      ))}
                    </select>
                  )}
                  <button onClick={() => void downloadPdf(report.id, report.weekFriday, report.version)} disabled={pdfBusy}
                    className="flex items-center gap-2 rounded-lg bg-[#00823C] px-3 py-2 text-sm font-medium text-white hover:bg-[#006e33] disabled:opacity-60">
                    {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    PDF
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {/* ═══ БЛОК 2 — KPI ═══ */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-500">Общий прогресс</p>
            <p className="mt-1 text-3xl font-bold text-[#28282D]">{kpi.overallPercent}%</p>
            <div className="mt-1"><Delta value={kpi.overallDelta} /></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-[#00823C]" style={{ width: `${kpi.overallPercent}%` }} />
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-500">Освоение бюджета</p>
            <p className="mt-1 text-3xl font-bold text-[#28282D]">{kpi.spentPercent}%</p>
            <div className="mt-1"><Delta value={kpi.spentDelta} /></div>
            <p className="mt-2 text-xs text-gray-400">
              <Wallet className="mr-1 inline h-3.5 w-3.5" />
              {fmtMoney(budget?.spent ?? 0)}
            </p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-500">Отставание по графику</p>
            <p className="mt-1 text-3xl font-bold text-[#28282D]">
              {kpi.maxDelayDays} <span className="text-lg font-normal text-gray-400">дней</span>
            </p>
            <p className="mt-1 text-2xl">{LIGHT_EMOJI[kpi.delayLight]}</p>
            <p className="mt-1 text-xs text-gray-400">
              пороги: 🟡 {project.delayYellowDays} · 🔴 {project.delayRedDays} дн.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-500">Открытых проблем</p>
            <p className="mt-1 text-3xl font-bold text-[#28282D]">{kpi.openIssues}</p>
            <p className="mt-1 text-sm text-gray-500">
              🔴 {kpi.redIssues} · 🟡 {kpi.yellowIssues}
            </p>
            <p className="mt-2 text-xs text-gray-400">
              Предписаний открыто: {kpi.prescriptionsOpen}
            </p>
          </div>
        </div>

        {/* ═══ БЛОК 3 — Сводный светофор ═══ */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="mb-4 text-lg font-bold text-[#28282D]">
            Прогресс по разделам · сводный светофор
          </h2>
          {sections.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">Нет разделов работ</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="pb-3">Раздел</th>
                    <th className="pb-3">Прогресс</th>
                    <th className="w-20 pb-3">%</th>
                    <th className="w-28 pb-3">Δ нед.</th>
                    <th className="w-28 pb-3">Отставание</th>
                    <th className="w-16 pb-3">🚦</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sections.map((s) => (
                    <tr key={s.id} className={s.isCritical ? 'bg-red-50/40' : ''}>
                      <td className="py-3 pr-3">
                        <p className="font-medium text-[#28282D]">
                          {s.name} {s.isCritical && <span title="Критический путь">⚠️</span>}
                        </p>
                        <p className="text-xs text-gray-400">{s.contractor ?? 'подрядчик не назначен'}</p>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="h-2.5 w-full min-w-[120px] overflow-hidden rounded-full bg-gray-100">
                          <div className={`h-full rounded-full ${
                            s.light === 'red' ? 'bg-red-500' : s.light === 'yellow' ? 'bg-amber-500' : 'bg-[#00823C]'
                          }`} style={{ width: `${s.percentDone}%` }} />
                        </div>
                      </td>
                      <td className="py-3 font-semibold text-[#28282D]">{s.percentDone}%</td>
                      <td className="py-3">
                        {s.weekDelta === 0
                          ? <span className="text-xs text-gray-400">—</span>
                          : <span className={`text-xs font-medium ${s.weekDelta > 0 ? 'text-[#00823C]' : 'text-red-600'}`}>
                              {s.weekDelta > 0 ? '+' : ''}{s.weekDelta}%
                            </span>}
                      </td>
                      <td className="py-3 text-gray-500">{s.delayDays} дн.</td>
                      <td className="py-3 text-xl">{LIGHT_EMOJI[s.light]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ═══ БЛОК 4 — S-кривая ═══ */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="mb-4 text-lg font-bold text-[#28282D]">
            График выполнения · план / факт
          </h2>
          {sCurve.length < 1 ? (
            <p className="py-8 text-center text-sm text-gray-400">Недостаточно данных</p>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sCurve} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
                  <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => [`${v}%`, '']} />
                  <Legend />
                  <Line type="monotone" dataKey="plan" name="План"
                    stroke="#9CA3AF" strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="fact" name="Факт"
                    stroke={GREEN} strokeWidth={3} dot={{ r: 4 }} connectNulls />
                  <Line type="monotone" dataKey="forecast" name="Прогноз"
                    stroke={GREEN} strokeDasharray="7 5" strokeWidth={2.5} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* ═══ БЛОК 5 — Проблематика + Бюджет ═══ */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 lg:col-span-2">
            <h2 className="mb-4 text-lg font-bold text-[#28282D]">Проблематика</h2>
            {issues.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">Проблем нет 🎉</p>
            ) : (
              <div className="space-y-3">
                {issues.map((i) => (
                  <div key={i.id} className={`rounded-xl border-l-4 p-3 ${
                    i.status === 'red' ? 'border-red-500 bg-red-50/50'
                      : i.status === 'yellow' ? 'border-amber-500 bg-amber-50/50'
                      : 'border-[#00823C] bg-green-50/50'
                  }`}>
                    <p className="font-medium text-[#28282D]">
                      {ISSUE_STATUS_LABELS[i.status].slice(0, 2)} {i.description}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">{i.action}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      {i.responsible ?? 'ответственный не указан'} · срок {fmtDate(i.dueDate)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <h2 className="mb-2 text-lg font-bold text-[#28282D]">Освоение бюджета</h2>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donut} dataKey="value" nameKey="name"
                    innerRadius={55} outerRadius={80} startAngle={90} endAngle={-270}>
                    <Cell fill={GREEN} />
                    <Cell fill={GRAY} />
                  </Pie>
                  <Tooltip formatter={(v) => [fmtMoney(Number(v)), '']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-[#00823C]">{budget?.spentPercent ?? 0}%</p>
              <p className="mt-1 text-sm text-gray-500">
                {fmtMoney(budget?.spent ?? 0)} из {fmtMoney(budget?.projectBudget ?? 0)}
              </p>
              <div className="mt-1"><Delta value={budget?.percentDelta ?? 0} /></div>
              {budget?.rdStage && (
                <p className="mt-2 text-xs text-gray-400">Стадия РД: {budget.rdStage}</p>
              )}
            </div>
          </section>
        </div>

        {/* ═══ БЛОК 6 — Ресурсы ═══ */}
        {resources && (
          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <h2 className="mb-4 text-lg font-bold text-[#28282D]">Ресурсы на площадке</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {[
                { label: 'ИТР', value: resources.itr, d: resources.deltas.itr },
                { label: 'Рабочие', value: resources.workers, d: resources.deltas.workers },
                { label: 'Техника', value: resources.machinery, d: resources.deltas.machinery },
              ].map((r) => (
                <div key={r.label} className="rounded-xl bg-gray-50 p-4 text-center">
                  <p className="text-sm text-gray-500">{r.label}</p>
                  <p className="mt-1 text-2xl font-bold text-[#28282D]">{r.value}</p>
                  <div className="mt-1 flex justify-center"><Delta value={r.d} suffix="" /></div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  );
}
