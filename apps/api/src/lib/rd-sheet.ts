import { parseCsv } from "./participant-directory.js";

export interface RdSheetSummary {
  volumesTotal: number;
  handedToCustomer: number;
  onReview: number;
  issuedVpr: number;
  inProgress: number;
  withRemarks: number;
}

const normalize = (value: string) => value.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");

// Google получает один запрос на весь реестр, а не отдельный запрос на строку.
// Кэш и объединение одновременных загрузок защищают квоту при двойном клике
// или одновременной работе нескольких специалистов с одним проектом.
const RD_CACHE_TTL_MS = 2 * 60_000;
const rdSummaryCache = new Map<string, { expiresAt: number; summary: RdSheetSummary }>();
const rdSummaryInFlight = new Map<string, Promise<RdSheetSummary>>();

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
  return Math.min(10_000, 1_000 * 2 ** attempt);
}

function findHeader(headers: string[], aliases: string[]) {
  return headers.findIndex((header) => aliases.some((alias) => header.includes(alias)));
}

/** Правки v6: агрегируем реестр РД в шесть показателей отчёта. */
export function summarizeRdCsv(source: string): RdSheetSummary {
  const rows = parseCsv(source.replace(/^\uFEFF/, ""));
  if (!rows.length) throw new Error("Лист «Реестр РД» пуст");
  const headers = rows[0].map(normalize);
  const codeIndex = findHeader(headers, ["шифр комплекта", "шифр"]);
  const nameIndex = findHeader(headers, ["наименование раздела", "наименование"]);
  const statusIndex = findHeader(headers, ["статус раздела рд", "статус"]);
  if (statusIndex < 0 || (codeIndex < 0 && nameIndex < 0)) {
    throw new Error("Нужны колонки «Шифр комплекта» (или «Наименование раздела») и «Статус раздела РД»");
  }

  const dataRows = rows.slice(1).filter((row) =>
    Boolean((row[codeIndex] ?? "").trim() || (row[nameIndex] ?? "").trim()),
  );
  const statuses = dataRows.map((row) => normalize(row[statusIndex] ?? ""));
  const matches = (status: string, fragments: string[]) => fragments.some((fragment) => status.includes(fragment));

  return {
    volumesTotal: dataRows.length,
    // По уточнению заказчика: передано = сейчас на рассмотрении + уже выдано ВПР.
    handedToCustomer: statuses.filter((status) =>
      matches(status, ["на рассмотрении", "на проверке", "выдано в производство"]),
    ).length,
    onReview: statuses.filter((status) => matches(status, ["на рассмотрении", "на проверке"])).length,
    issuedVpr: statuses.filter((status) => matches(status, ["выдано в производство"])).length,
    inProgress: statuses.filter((status) => !status || matches(status, ["в разработке", "не начат"])).length,
    withRemarks: statuses.filter((status) => matches(status, ["внести корректиров", "выданы замечан", "с замечаниями"])).length,
  };
}

function rdSheetUrl(projectUrl?: string | null) {
  if (projectUrl?.trim()) {
    const parsed = new URL(projectUrl.trim());
    const match = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
    if (parsed.hostname !== "docs.google.com" || !match) throw new Error("Некорректная ссылка Google Sheets проекта");
    const gid = parsed.searchParams.get("gid");
    const query = new URLSearchParams({ tqx: "out:csv", sheet: "Реестр РД" });
    if (gid) query.set("gid", gid);
    return `https://docs.google.com/spreadsheets/d/${match[1]}/gviz/tq?${query}`;
  }
  const direct = process.env.RD_SHEET_CSV_URL?.trim();
  if (direct) return direct;
  const id = process.env.RD_SHEET_ID?.trim();
  if (!id) return null;
  const sheet = process.env.RD_SHEET_NAME?.trim() || "Реестр РД";
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}`;
}

export function isRdSheetConfigured(projectUrl?: string | null) {
  return Boolean(rdSheetUrl(projectUrl));
}

/** Серверное чтение: адрес и данные Google не попадают в браузер. */
async function requestRdSheetSummary(url: URL, attempt = 0, forceRefresh = false): Promise<RdSheetSummary> {
  const requestUrl = new URL(url);
  // Ручная актуализация должна обходить промежуточный кэш Google/gviz.
  if (forceRefresh) requestUrl.searchParams.set("_refresh", String(Date.now()));
  const response = await fetch(requestUrl, { signal: AbortSignal.timeout(15_000) });
  if (response.status === 429 && attempt < 2) {
    await wait(retryAfterMs(response.headers.get("retry-after"), attempt));
    return requestRdSheetSummary(url, attempt + 1, forceRefresh);
  }
  if (response.status === 429) throw new Error("Google Sheets временно исчерпал лимит запросов; повторите позже");
  if (!response.ok) throw new Error(`Google Sheets вернул HTTP ${response.status}`);
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > 5_000_000) throw new Error("Реестр РД превышает 5 МБ");
  const source = await response.text();
  if (source.length > 5_000_000) throw new Error("Реестр РД превышает 5 МБ");
  return summarizeRdCsv(source);
}

export async function loadRdSheetSummary(projectUrl?: string | null, options: { forceRefresh?: boolean } = {}) {
  const rawUrl = rdSheetUrl(projectUrl);
  if (!rawUrl) throw new Error("Не настроен источник реестра РД");
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !["docs.google.com", "docs.googleusercontent.com"].includes(url.hostname)) {
    throw new Error("Разрешена только HTTPS-ссылка Google Sheets");
  }
  const cacheKey = url.toString();
  const cached = rdSummaryCache.get(cacheKey);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) return cached.summary;
  const existing = rdSummaryInFlight.get(cacheKey);
  if (existing) return existing;

  const loading = requestRdSheetSummary(url, 0, options.forceRefresh).then((summary) => {
    rdSummaryCache.set(cacheKey, { expiresAt: Date.now() + RD_CACHE_TTL_MS, summary });
    return summary;
  });
  rdSummaryInFlight.set(cacheKey, loading);
  try { return await loading; }
  finally { rdSummaryInFlight.delete(cacheKey); }
}
