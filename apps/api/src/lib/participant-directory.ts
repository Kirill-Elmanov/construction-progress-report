import type { RoleType } from "@prisma/client";

export interface DirectoryPerson {
  id: string;
  displayName: string;
  email: string;
  role: RoleType;
}

const ROLE_ALIASES: Array<[RegExp, RoleType]> = [
  [/^пзгд$/i, "pzgd"],
  [/^(руководитель проектов|руководитель проекта|рп)$/i, "head_of_projects"],
  [/^гип$/i, "gip"],
  [/^(зам\.?\s*гипа|заместитель гипа)$/i, "gip_deputy"],
  [/^координатор( проекта)?$/i, "coordinator"],
  [/^(стройконтроль|строительный контроль)$/i, "stroycontrol"],
];

const NAME_HEADERS = ["фио", "ф.и.о.", "сотрудник"];
const EMAIL_HEADERS = ["почта рабочая", "рабочая почта", "email", "e-mail", "почта"];
const ROLE_HEADERS = ["роль в проекте", "роль", "проектная роль"];

/** Минимальный CSV-парсер с поддержкой кавычек и переносов внутри ячеек. */
export function parseCsv(source: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted && char === '"' && source[index + 1] === '"') {
      value += '"'; index++; continue;
    }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === ",") { row.push(value); value = ""; continue; }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && source[index + 1] === "\n") index++;
      row.push(value); value = "";
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      continue;
    }
    value += char;
  }
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function normalized(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function columnIndex(headers: string[], aliases: string[]) {
  return headers.findIndex((header) => aliases.includes(normalized(header)));
}

export function mapParticipantRole(value: string) {
  const clean = value.trim();
  return ROLE_ALIASES.find(([pattern]) => pattern.test(clean))?.[1] ?? null;
}

export function parseDirectoryCsv(source: string): DirectoryPerson[] {
  const rows = parseCsv(source.replace(/^\uFEFF/, ""));
  if (!rows.length) return [];
  const nameIndex = columnIndex(rows[0], NAME_HEADERS);
  const emailIndex = columnIndex(rows[0], EMAIL_HEADERS);
  const roleIndex = columnIndex(rows[0], ROLE_HEADERS);
  if ([nameIndex, emailIndex, roleIndex].some((index) => index < 0)) {
    throw new Error("В Google-таблице нужны колонки «ФИО», «Почта рабочая» и «Роль в проекте»");
  }

  return rows.slice(1).flatMap((row, index) => {
    const displayName = row[nameIndex]?.trim() ?? "";
    const email = row[emailIndex]?.trim().toLowerCase() ?? "";
    const role = mapParticipantRole(row[roleIndex] ?? "");
    if (!displayName || !email || !role || !email.includes("@")) return [];
    return [{ id: `${index + 2}:${email}`, displayName, email, role }];
  });
}

let cache: { url: string; expiresAt: number; people: DirectoryPerson[] } | null = null;

/** Читаем только опубликованные Google CSV; произвольные URL запрещены. */
export async function loadParticipantDirectory(csvUrl: string) {
  const url = new URL(csvUrl);
  if (url.protocol !== "https:" || !["docs.google.com", "docs.googleusercontent.com"].includes(url.hostname)) {
    throw new Error("Разрешена только HTTPS-ссылка на опубликованную Google-таблицу");
  }
  if (cache?.url === csvUrl && cache.expiresAt > Date.now()) return cache.people;

  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Google-таблица вернула HTTP ${response.status}`);
  const source = await response.text();
  if (source.length > 1_000_000) throw new Error("Google-справочник больше 1 МБ");
  const people = parseDirectoryCsv(source);
  cache = { url: csvUrl, expiresAt: Date.now() + 5 * 60_000, people };
  return people;
}
