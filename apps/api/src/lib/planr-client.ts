import { readFileSync } from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { z } from "zod";

export interface PlanrWbsNode {
  id: string;
  parentId?: string | null;
  code?: string | null;
  name?: string | null;
  type?: string | null;
  level?: number | null;
  sortOrder?: number | null;
  values?: unknown;
}

export const planrAttrMapSchema = z.object({
  code: z.string().uuid().optional(),
  name: z.string().uuid().optional(),
  type: z.string().uuid().optional(),
  // forecast* — текущие расчётные даты «Старт / Финиш».
  forecastStart: z.string().uuid().optional(),
  forecastFinish: z.string().uuid().optional(),
  // target* — зафиксированные «Целевой старт / Целевой финиш».
  targetStart: z.string().uuid().optional(),
  targetFinish: z.string().uuid().optional(),
  // Старые ключи читаем для совместимости с уже созданными проектами.
  planStart: z.string().uuid().optional(),
  planFinish: z.string().uuid().optional(),
  percentDone: z.string().uuid().optional(),
  delayDays: z.string().uuid().optional(),
}).strict();
export type PlanrAttrMap = z.infer<typeof planrAttrMapSchema>;

export const DEFAULT_PLANR_ATTR_MAP: PlanrAttrMap = {
  code: "00000000-0000-4000-8000-000000000001",
  name: "00000000-0000-4000-8000-000000000002",
  // PLAN-R: обычные даты используются для прогноза фактического завершения.
  forecastStart: "00000000-0000-4000-8000-000000000003",
  forecastFinish: "00000000-0000-4000-8000-000000000004",
  // PLAN-R: целевые даты формируют серую плановую S-кривую.
  targetStart: "00000000-0000-4000-8000-000000000025",
  targetFinish: "00000000-0000-4000-8000-000000000026",
  // Для отчёта используется колонка «Выполнение (%) расчет», а не системный
  // прогресс, который в реальном графике может отличаться (например, 71,64 и 95).
  percentDone: "914a3be4-72d0-4a40-aa13-bd9cc38b40bd",
  type: "00000000-0000-4000-8000-000000000054",
};

export function isSCurveAttrMapConfigured(value: unknown): value is PlanrAttrMap {
  const parsed = planrAttrMapSchema.safeParse(value);
  return Boolean(parsed.success
    && (parsed.data.forecastStart || parsed.data.planStart)
    && (parsed.data.forecastFinish || parsed.data.planFinish)
    && parsed.data.targetStart
    && parsed.data.targetFinish
    && parsed.data.percentDone);
}

export interface PlanrScheduleRow {
  code: string;
  name: string;
  planStart: string | null;
  planFinish: string | null;
  delayDays: number | null;
  percentDone: number | null;
  weekGrowth: number | null;
  planrWbsId: string;
}

export interface PlanrSnapshotRow {
  wbsId: string;
  parentWbsId: string | null;
  code: string | null;
  name: string;
  nodeType: string | null;
  targetStart: string | null;
  targetFinish: string | null;
  forecastStart: string | null;
  forecastFinish: string | null;
  percentDone: number | null;
  sortOrder: number;
}

export function isPlanrEnvironmentConfigured() {
  return Boolean(process.env.PLANR_BASE_URL && process.env.PLANR_TOKEN && process.env.PLANR_TENANT_ID);
}

// PLAN-R допускает 1000 запросов за 60 секунд. Глобальная очередь оставляет
// большой запас и не даёт параллельным пользователям устроить всплеск запросов.
const PLANR_REQUEST_GAP_MS = 100;
const PLANR_CACHE_TTL_MS = 2 * 60_000;
let requestQueue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
const wbsCache = new Map<string, { expiresAt: number; rows: PlanrWbsNode[] }>();
const wbsInFlight = new Map<string, Promise<PlanrWbsNode[]>>();

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterMs(value: string | null, attempt: number) {
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(1_000, seconds * 1_000);
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(1_000, date - Date.now());
  }
  return Math.min(30_000, 1_000 * 2 ** attempt);
}

function queuedRequest<T>(operation: () => Promise<T>): Promise<T> {
  const run = requestQueue.catch(() => undefined).then(async () => {
    const delay = Math.max(0, PLANR_REQUEST_GAP_MS - (Date.now() - lastRequestAt));
    if (delay) await wait(delay);
    lastRequestAt = Date.now();
    return operation();
  });
  requestQueue = run;
  return run;
}

interface PlanrHttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  payload: unknown;
}

/**
 * PLAN-R использует корпоративный сертификат. В production следует передать
 * корневой сертификат через PLANR_CA_CERT_PATH. Небезопасный режим разрешён
 * только явным флагом и действует исключительно для запросов к PLAN-R.
 */
function planrJsonRequest(url: URL): Promise<PlanrHttpResponse> {
  const caPath = process.env.PLANR_CA_CERT_PATH?.trim();
  const allowInsecureTls = process.env.PLANR_TLS_INSECURE === "true";
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method: "GET",
      headers: {
        Authorization: process.env.PLANR_TOKEN ?? "",
        "x-tenant-id": process.env.PLANR_TENANT_ID ?? "",
        "x-version": process.env.PLANR_API_VERSION ?? "409",
        accept: "application/json;odata.metadata=minimal;odata.streaming=true",
      },
      rejectUnauthorized: !allowInsecureTls,
      ...(caPath ? { ca: readFileSync(caPath) } : {}),
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 20_000_000) {
          request.destroy(new Error("Ответ PLAN-R превышает 20 МБ"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let payload: unknown = null;
        if (body) {
          try { payload = JSON.parse(body); }
          catch { payload = body; }
        }
        resolve({ status: response.statusCode ?? 0, headers: response.headers, payload });
      });
    });
    request.setTimeout(30_000, () => request.destroy(new Error("PLAN-R не ответил за 30 секунд")));
    request.on("error", reject);
    request.end();
  });
}

function unwrapAttributeValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "value" in value) {
    return (value as { value: unknown }).value;
  }
  return value;
}

function attributeValue(values: unknown, id?: string): unknown {
  if (!id || values == null) return null;
  if (typeof values === "string") {
    try { return attributeValue(JSON.parse(values), id); }
    catch { return null; }
  }
  if (Array.isArray(values)) {
    const row = values.find((item) => item && typeof item === "object"
      && (String((item as any).attributeId ?? (item as any).wbsAttributeId ?? (item as any).id) === id));
    return row && typeof row === "object" ? unwrapAttributeValue((row as any).value ?? null) : null;
  }
  if (typeof values === "object") {
    return unwrapAttributeValue((values as Record<string, unknown>)[id] ?? null);
  }
  return null;
}

function dateValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const date = typeof value === "number" || /^\d{13}$/.test(String(value))
    ? new Date(Number(value)) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

/** Полный снимок нужен для S-кривой и декомпозиции по зданиям. */
export function mapPlanrSnapshot(nodes: PlanrWbsNode[], attrMap: PlanrAttrMap): PlanrSnapshotRow[] {
  const supportedTypes = new Set(["work", "task", "sum", "milestone_start", "milestone_finish"]);
  return nodes.flatMap((node, index) => {
    if (!node.id) return [];
    const nodeType = String(node.type ?? attributeValue(node.values, attrMap.type) ?? "task");
    if (!supportedTypes.has(nodeType)) return [];
    const code = String(node.code ?? attributeValue(node.values, attrMap.code) ?? "").trim() || null;
    const name = String(node.name ?? attributeValue(node.values, attrMap.name) ?? code ?? "Без наименования").trim();
    const forecastStart = dateValue(attributeValue(node.values, attrMap.forecastStart ?? attrMap.planStart));
    const forecastFinish = dateValue(attributeValue(node.values, attrMap.forecastFinish ?? attrMap.planFinish));
    // У суммарных строк PLAN-R целевые даты могут быть null. В интерфейсе PLAN-R
    // такие границы визуально наследуются от текущих дат — повторяем это правило.
    const targetStart = dateValue(attributeValue(node.values, attrMap.targetStart)) ?? forecastStart;
    const targetFinish = dateValue(attributeValue(node.values, attrMap.targetFinish)) ?? forecastFinish;
    return [{
      wbsId: node.id,
      parentWbsId: node.parentId ?? null,
      code,
      name,
      nodeType,
      targetStart,
      targetFinish,
      forecastStart,
      forecastFinish,
      percentDone: numberValue(attributeValue(node.values, attrMap.percentDone)),
      sortOrder: node.sortOrder ?? index,
    }];
  }).sort((left, right) => left.sortOrder - right.sortOrder
    || String(left.code ?? "").localeCompare(String(right.code ?? ""), "ru", { numeric: true }));
}

/** Преобразование отделено от HTTP, чтобы соответствие атрибутов можно было тестировать. */
export function mapPlanrSchedule(nodes: PlanrWbsNode[], attrMap: PlanrAttrMap, previous = new Map<string, number>()) {
  const supportedTypes = new Set(["work", "task", "sum", "milestone_start", "milestone_finish"]);
  return nodes
    .filter((node) => node.id && node.code && supportedTypes.has(String(node.type ?? "task")))
    .map((node) => {
      const percentDone = numberValue(attributeValue(node.values, attrMap.percentDone));
      const previousPercent = previous.get(node.id);
      const mappedName = attributeValue(node.values, attrMap.name);
      return {
        code: String(node.code).trim(),
        name: String(node.name ?? mappedName ?? node.code).trim(),
        planStart: dateValue(attributeValue(node.values, attrMap.planStart)),
        planFinish: dateValue(attributeValue(node.values, attrMap.planFinish)),
        delayDays: numberValue(attributeValue(node.values, attrMap.delayDays)),
        percentDone,
        weekGrowth: percentDone !== null && previousPercent !== undefined
          ? Math.round((percentDone - previousPercent) * 100) / 100 : null,
        planrWbsId: node.id,
        sortOrder: node.sortOrder ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code, "ru", { numeric: true }))
    .map(({ sortOrder: _sortOrder, ...row }) => row);
}

function responseRows(payload: unknown): PlanrWbsNode[] {
  if (Array.isArray(payload)) return payload as PlanrWbsNode[];
  if (payload && typeof payload === "object") {
    const rows = (payload as any).value ?? (payload as any).items ?? (payload as any).data;
    if (Array.isArray(rows)) return rows as PlanrWbsNode[];
  }
  throw new Error("PLAN-R вернул неизвестный формат списка ИСР");
}

async function requestPage(url: URL, attempt = 0): Promise<PlanrWbsNode[]> {
  const response = await queuedRequest(() => planrJsonRequest(url));
  const retryAfter = Array.isArray(response.headers["retry-after"])
    ? response.headers["retry-after"][0] : response.headers["retry-after"] ?? null;
  if (response.status === 429 && attempt < 3) {
    await wait(retryAfterMs(retryAfter, attempt));
    return requestPage(url, attempt + 1);
  }
  if (response.status === 429) throw new Error("PLAN-R временно исчерпал лимит запросов; повторите позже");
  if (response.status === 401) throw new Error("PLAN-R отклонил токен; проверьте срок действия");
  if (response.status === 403) throw new Error("Токен PLAN-R не имеет доступа к запрошенному графику");
  if (response.status < 200 || response.status >= 300) throw new Error(`PLAN-R вернул HTTP ${response.status}`);
  return responseRows(response.payload);
}

/** Документация PLAN-R ограничивает одну страницу ста записями. */
export function deduplicatePlanrNodes(nodes: PlanrWbsNode[]) {
  const byId = new Map<string, PlanrWbsNode>();
  for (const node of nodes) {
    if (node.id) byId.set(node.id, node);
  }
  return [...byId.values()];
}

export async function loadPlanrWbs(epsId: string, attrMap: PlanrAttrMap) {
  const rawBase = process.env.PLANR_BASE_URL?.trim();
  if (!rawBase || !isPlanrEnvironmentConfigured()) throw new Error("Не настроены реквизиты PLAN-R");
  const base = new URL(rawBase.endsWith("/") ? rawBase : `${rawBase}/`);
  const attributeIds = [...new Set(Object.values(attrMap).filter(Boolean))];
  const cacheKey = `${process.env.PLANR_TENANT_ID}:${epsId}:${attributeIds.sort().join(",")}`;
  const cached = wbsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  const existing = wbsInFlight.get(cacheKey);
  if (existing) return existing;

  const loading = (async () => {
    const result: PlanrWbsNode[] = [];
    for (let skip = 0; skip < 10_000; skip += 100) {
      const url = new URL("wbs", base);
      url.searchParams.set("epsId", epsId);
      url.searchParams.set("$top", "100");
      url.searchParams.set("$skip", String(skip));
      // sortOrder не уникален. Без второго ключа PLAN-R может вернуть одну
      // работу на двух соседних страницах при использовании $skip.
      url.searchParams.set("$orderby", "sortOrder asc,id asc");
      // В описании параметров PLAN-R используется каноническое имя
      // attributeIds (единственное число attribute + множественное Ids).
      attributeIds.forEach((id) => url.searchParams.append("attributeIds", id));
      const page = await requestPage(url);
      result.push(...page);
      if (page.length < 100) {
        const rows = deduplicatePlanrNodes(result);
        wbsCache.set(cacheKey, { expiresAt: Date.now() + PLANR_CACHE_TTL_MS, rows });
        return rows;
      }
    }
    throw new Error("PLAN-R вернул больше 10 000 работ; уточните границы графика");
  })();
  wbsInFlight.set(cacheKey, loading);
  try { return await loading; }
  finally { wbsInFlight.delete(cacheKey); }
}
