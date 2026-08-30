// ═══════════════════════════════════════════════════════════
// Расчётные поля (ТЗ 3.4 + расчётные блоки секций В/Д/Е/Ж).
// НЕ хранятся в БД — считаются на лету (решение ERD).
// Shared: используется и API (services), и фронтом (превью).
// ═══════════════════════════════════════════════════════════

import type { TrafficLight } from '../types/index.js';

const MS_PER_DAY = 86_400_000;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// ─── В-р3 / 3.4: Светофор отставания (Развилка 1 зафиксирована) ──
// 🟢 delay < yellow(5) · 🟡 yellow ≤ delay < red(14) · 🔴 delay ≥ red
export function delayTrafficLight(
  delayDays: number,
  yellowDays = 5,
  redDays = 14,
): TrafficLight {
  if (delayDays < yellowDays) return 'green';
  if (delayDays < redDays) return 'yellow';
  return 'red';
}

// ─── В-р1: Прирост % за неделю = В3(тек) − В3(пред) ──────────
// Прошлой недели нет (первая неделя) → прирост = текущий %
export function weeklyDelta(current: number, previous: number | null | undefined): number {
  return previous == null ? current : current - previous;
}

// ─── В-р2: Отставание, дней (формула из ТЗ дословно) ─────────
// Плановый % на сегодня = (сегодня − Б5) / (Б6 − Б5) × 100, clamp 0…100
// Длительность = Б6 − Б5 (дней)
// Отставание = (Плановый % − В3) / 100 × Длительность; <0 → 0
export function planPercentToday(planStart: Date, planFinish: Date, today: Date): number {
  const duration = planFinish.getTime() - planStart.getTime();
  if (duration <= 0) return 100; // защита: некорректные/нулевые сроки
  const elapsed = today.getTime() - planStart.getTime();
  return clamp((elapsed / duration) * 100, 0, 100);
}

export function delayDays(
  factPercent: number,
  planStart: Date,
  planFinish: Date,
  today: Date = new Date(),
): number {
  const planPct = planPercentToday(planStart, planFinish, today);
  const durationDays = (planFinish.getTime() - planStart.getTime()) / MS_PER_DAY;
  const delay = ((planPct - factPercent) / 100) * durationDays;
  return Math.max(0, delay); // опережение → 0
}

// Композит: отставание + светофор одного раздела (для дашборда БЛОК 3)
export function sectionDelayStatus(
  factPercent: number,
  planStart: Date,
  planFinish: Date,
  thresholds: { yellow: number; red: number } = { yellow: 5, red: 14 },
  today: Date = new Date(),
): { delayDays: number; light: TrafficLight } {
  const d = Math.round(delayDays(factPercent, planStart, planFinish, today));
  return { delayDays: d, light: delayTrafficLight(d, thresholds.yellow, thresholds.red) };
}

// ─── Секция Д: предписания ───────────────────────────────────
export function prescriptionStats(
  cur: { issuedTotal: number; resolvedTotal: number },
  prev?: { issuedTotal: number; resolvedTotal: number } | null,
) {
  return {
    open: cur.issuedTotal - cur.resolvedTotal,                     // открытых
    issuedWeek: cur.issuedTotal - (prev?.issuedTotal ?? 0),        // выдано за нед.
    resolvedWeek: cur.resolvedTotal - (prev?.resolvedTotal ?? 0),  // устранено за нед.
  };
}

// ─── Секция Е: бюджет (деньги = bigint, РУБЛИ — решение ERD) ─
export function budgetStats(
  spentTotal: bigint,
  budget: bigint,
  prevSpentTotal?: bigint | null,
) {
  const pct = budget > 0n ? Number((spentTotal * 10000n) / budget) / 100 : 0; // 2 знака
  const prevPct =
    prevSpentTotal != null && budget > 0n
      ? Number((prevSpentTotal * 10000n) / budget) / 100
      : 0;
  return {
    spentPercent: pct,                                       // Освоение, %
    spentWeek: spentTotal - (prevSpentTotal ?? 0n),           // Освоено за нед., ₽
    percentDelta: Math.round((pct - prevPct) * 100) / 100,    // Прирост освоения, %
  };
}

// ─── Секция Ж: Δ ресурсов → ▲/▼ ─────────────────────────────
export function resourceDelta(cur: number, prev?: number | null) {
  const delta = cur - (prev ?? cur);
  return { delta, arrow: delta > 0 ? '▲' : delta < 0 ? '▼' : '' as const };
}

// ─── Форматирование денег: «12 500 000 ₽» (решение ERD) ─────
export function formatRub(v: bigint | number): string {
  return `${v.toLocaleString('ru-RU').replace(/,/g, ' ')} ₽`;
}

// ─── Отчётная пятница (В1): текущая пятница по МСК ──────────
export function currentReportFriday(now: Date = new Date()): Date {
  // МСК = UTC+3 без DST — смещаем и работаем в UTC-компонентах
  const msk = new Date(now.getTime() + 3 * 3_600_000);
  const dow = msk.getUTCDay(); // 0=вс…5=пт
  const diff = (5 - dow + 7) % 7; // до ближайшей пятницы (вкл. сегодня)
  const friday = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() + diff));
  return friday;
}