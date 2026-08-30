import type { PlanrSnapshotRow } from "./planr-client.js";

export const PROJECT_SCOPE_ID = "__project__";

export interface CurveScope {
  id: string;
  name: string;
  code: string | null;
  overall: boolean;
  depth: number;
}

export interface FactPoint {
  date: string;
  percent: number;
}

const DAY = 86_400_000;
const clamp = (value: number) => Math.max(0, Math.min(100, value));

function curveRows(rows: PlanrSnapshotRow[]) {
  const excluded = new Set(rows
    .filter((row) => /процедур[аы]\s+ввода/i.test(row.name))
    .map((row) => row.wbsId));
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (row.parentWbsId && excluded.has(row.parentWbsId) && !excluded.has(row.wbsId)) {
        excluded.add(row.wbsId);
        changed = true;
      }
    }
  }
  return rows.filter((row) => !excluded.has(row.wbsId));
}

function descendants(allRows: PlanrSnapshotRow[], scopeId: string) {
  const rows = curveRows(allRows);
  if (scopeId === PROJECT_SCOPE_ID) return rows;
  const children = new Map<string, PlanrSnapshotRow[]>();
  rows.forEach((row) => {
    if (!row.parentWbsId) return;
    children.set(row.parentWbsId, [...(children.get(row.parentWbsId) ?? []), row]);
  });
  const result: PlanrSnapshotRow[] = [];
  const queue = [scopeId];
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift()!;
    const own = rows.find((row) => row.wbsId === id);
    if (own) result.push(own);
    for (const child of children.get(id) ?? []) {
      if (!seen.has(child.wbsId)) { seen.add(child.wbsId); queue.push(child.wbsId); }
    }
  }
  return result;
}

function hasChildren(rows: PlanrSnapshotRow[], id: string) {
  return rows.some((row) => row.parentWbsId === id);
}

/** Все сводные разделы доступны в фильтре, кроме «Процедуры ввода». */
export function selectCurveScopes(rows: PlanrSnapshotRow[]): CurveScope[] {
  const available = curveRows(rows);
  const known = new Map(available.map((row) => [row.wbsId, row]));
  const roots = new Set(available
    .filter((row) => !row.parentWbsId || !known.has(row.parentWbsId))
    .map((row) => row.wbsId));
  const summaries = available.filter((row) => hasChildren(available, row.wbsId));
  const candidates = summaries.some((row) => !roots.has(row.wbsId))
    ? summaries.filter((row) => !roots.has(row.wbsId))
    : summaries;

  const depthOf = (row: PlanrSnapshotRow) => {
    let depth = 0;
    let parentId = row.parentWbsId;
    const seen = new Set<string>();
    while (parentId && known.has(parentId) && !roots.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      depth += 1;
      parentId = known.get(parentId)?.parentWbsId ?? null;
    }
    return depth;
  };
  return [
    { id: PROJECT_SCOPE_ID, name: "Весь объект", code: null, overall: true, depth: 0 },
    ...candidates.sort((a, b) => a.sortOrder - b.sortOrder).map((row) => ({
      id: row.wbsId, name: row.name, code: row.code, overall: false, depth: depthOf(row),
    })),
  ];
}

function leafRows(rows: PlanrSnapshotRow[]) {
  const parents = new Set(rows.map((row) => row.parentWbsId).filter(Boolean));
  const leaves = rows.filter((row) => !parents.has(row.wbsId)
    && !row.nodeType?.startsWith("milestone"));
  return leaves.length ? leaves : rows.filter((row) => !row.nodeType?.startsWith("milestone"));
}

export function scopePercent(rows: PlanrSnapshotRow[], scopeId: string) {
  const own = scopeId === PROJECT_SCOPE_ID ? null : rows.find((row) => row.wbsId === scopeId);
  if (own?.percentDone != null) return clamp(own.percentDone);
  const values = leafRows(descendants(rows, scopeId))
    .map((row) => row.percentDone).filter((value): value is number => value != null);
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : 0;
}

function linearPercent(date: number, start: string | null, finish: string | null) {
  if (!start || !finish) return null;
  const from = new Date(`${start}T00:00:00Z`).getTime();
  const to = new Date(`${finish}T00:00:00Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (to <= from) return date < from ? 0 : 100;
  return clamp(((date - from) / (to - from)) * 100);
}

function aggregateAt(rows: PlanrSnapshotRow[], date: number, kind: "target" | "forecast") {
  const values = leafRows(rows).flatMap((row) => {
    const value = kind === "target"
      ? linearPercent(date, row.targetStart, row.targetFinish)
      : linearPercent(date, row.forecastStart, row.forecastFinish);
    return value == null ? [] : [value];
  });
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function normalizedPlanAt(rows: PlanrSnapshotRow[], date: number, start: string | null, finish: string | null) {
  if (!start || !finish) return aggregateAt(rows, date, "target");
  const from = new Date(`${start}T00:00:00Z`).getTime();
  const to = new Date(`${finish}T00:00:00Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return aggregateAt(rows, date, "target");
  if (date <= from) return 0;
  if (date >= to) return 100;
  const raw = aggregateAt(rows, date, "target");
  const rawFrom = aggregateAt(rows, from, "target");
  const rawTo = aggregateAt(rows, to, "target");
  if (raw == null || rawFrom == null || rawTo == null || rawTo <= rawFrom) {
    return linearPercent(date, start, finish);
  }
  return clamp((raw - rawFrom) * 100 / (rawTo - rawFrom));
}

function scopeBoundary(allRows: PlanrSnapshotRow[], scopeId: string) {
  const available = curveRows(allRows);
  if (scopeId !== PROJECT_SCOPE_ID) return available.find((row) => row.wbsId === scopeId) ?? null;
  const known = new Set(available.map((row) => row.wbsId));
  return available.find((row) => hasChildren(available, row.wbsId)
    && (!row.parentWbsId || !known.has(row.parentWbsId))) ?? null;
}

function isoDate(value: number) { return new Date(value).toISOString().slice(0, 10); }

/** План — серая линия; факт — история; прогноз — зелёный пунктир после даты отчёта. */
export function buildSCurve(
  allRows: PlanrSnapshotRow[], scopeId: string, facts: FactPoint[], asOfDate: string,
) {
  const rows = descendants(allRows, scopeId);
  const boundary = scopeBoundary(allRows, scopeId);
  const targetStart = boundary?.targetStart
    ?? rows.map((row) => row.targetStart).filter((value): value is string => Boolean(value)).sort()[0] ?? null;
  const targetFinish = boundary?.targetFinish
    ?? rows.map((row) => row.targetFinish).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const forecastStart = boundary?.forecastStart
    ?? rows.map((row) => row.forecastStart).filter((value): value is string => Boolean(value)).sort()[0] ?? null;
  const forecastFinish = boundary?.forecastFinish
    ?? rows.map((row) => row.forecastFinish).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const dates = [targetStart, targetFinish, forecastStart, forecastFinish]
    .filter((value): value is string => Boolean(value)).map((value) => new Date(`${value}T00:00:00Z`).getTime());
  const factTimes = facts.map((point) => new Date(`${point.date}T00:00:00Z`).getTime());
  const asOf = new Date(`${asOfDate}T00:00:00Z`).getTime();
  const start = Math.min(asOf, ...dates, ...factTimes);
  const finish = Math.max(asOf, ...dates, ...factTimes);
  const timeline = new Set<number>([start, asOf, finish, ...factTimes]);
  for (let time = start; time <= finish; time += 7 * DAY) timeline.add(time);

  const current = facts.find((point) => point.date === asOfDate)?.percent
    ?? scopePercent(allRows, scopeId);
  const rawAtCurrent = aggregateAt(rows, asOf, "forecast") ?? current;
  const rawAtFinish = aggregateAt(rows, finish, "forecast") ?? 100;
  const factByDate = new Map(facts.map((point) => [point.date, point.percent]));

  return [...timeline].sort((a, b) => a - b).map((time) => {
    const date = isoDate(time);
    const rawForecast = aggregateAt(rows, time, "forecast");
    const forecast = time < asOf || rawForecast == null ? null
      : rawAtFinish <= rawAtCurrent
        ? (time === asOf ? current : 100)
        : clamp(current + (rawForecast - rawAtCurrent) * (100 - current) / (rawAtFinish - rawAtCurrent));
    const plan = normalizedPlanAt(rows, time, targetStart, targetFinish);
    return {
      date,
      label: new Date(time).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" }),
      plan: plan == null ? null : Math.round(plan * 10) / 10,
      fact: factByDate.get(date) ?? null,
      forecast: forecast == null ? null : Math.round(forecast * 10) / 10,
    };
  });
}
