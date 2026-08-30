/**
 * ПР-1.3: справочник сотрудников из Google-таблицы.
 * Источник — опубликованный CSV листа. Кэш в памяти на 10 минут.
 *
 * .env:
 *   EMPLOYEES_SHEET_ID=1AbC...          (id таблицы из URL)
 *   EMPLOYEES_SHEET_NAME=Справочник     (имя листа)
 *
 * Ожидаемые колонки листа (регистр не важен, порядок любой):
 *   email | ФИО | Должность
 */

interface Employee {
  email: string;
  fullName: string;
  position?: string;  // колонка «Роль»
  phone?: string;     // колонка «Контактный телефон»
}

let cache: { at: number; map: Map<string, Employee> } | null = null;
const TTL_MS = 10 * 60 * 1000;

function sheetUrl(): string | null {
  const id = process.env.EMPLOYEES_SHEET_ID;
  const name = process.env.EMPLOYEES_SHEET_NAME;
  if (!id) return null;
  const sheetParam = name ? `&sheet=${encodeURIComponent(name)}` : "";
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${sheetParam}`;
}

// Простой CSV-парсер с поддержкой кавычек
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const norm = (s: string) => s.trim().toLowerCase();

async function loadEmployees(): Promise<Map<string, Employee>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;

  const url = sheetUrl();
  const map = new Map<string, Employee>();
  if (!url) { cache = { at: Date.now(), map }; return map; }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Google Sheets ${res.status}`);
    const rows = parseCsv(await res.text());
    if (rows.length < 2) throw new Error("Пустой лист справочника");

    const header = rows[0].map(norm);
    const idxEmail = header.findIndex((h) => h.includes("почта") || h.includes("email") || h.includes("mail"));
    const idxName = header.findIndex((h) => h.includes("фио") || h.includes("имя") || h.includes("сотрудник"));
    const idxPos = header.findIndex((h) => h.includes("роль") || h.includes("должн"));
    const idxPhone = header.findIndex((h) => h.includes("телефон"));

    if (idxEmail === -1 || idxName === -1) {
      throw new Error("В листе нет колонок email / ФИО");
    }

    for (const r of rows.slice(1)) {
      const email = norm(r[idxEmail] ?? "");
      const fullName = (r[idxName] ?? "").trim();
      if (!email || !fullName) continue;
      map.set(email, {
        email,
        fullName,
        position: idxPos >= 0 ? (r[idxPos] ?? "").trim() || undefined : undefined,
        phone: idxPhone >= 0 ? (r[idxPhone] ?? "").trim() || undefined : undefined,
      });
    }
  } catch (e) {
    // Справочник недоступен — не роняем авторизацию, отдаём пустую карту
    console.error("⚠️ Справочник сотрудников недоступен:", (e as Error).message);
  }

  cache = { at: Date.now(), map };
  return map;
}

/** ФИО сотрудника по email (null, если в справочнике нет). */
export async function getEmployeeName(email: string): Promise<string | null> {
  const map = await loadEmployees();
  return map.get(norm(email))?.fullName ?? null;
}

/** Полная запись справочника по email. */
export async function getEmployee(email: string): Promise<Employee | null> {
  const map = await loadEmployees();
  return map.get(norm(email)) ?? null;
}

/** Принудительный сброс кэша (после правки таблицы). */
export function resetEmployeesCache() {
  cache = null;
}

/** Список всех сотрудников из справочника (для выпадашки при создании ссылки). */
export async function listEmployees(): Promise<Employee[]> {
  const map = await loadEmployees();
  return [...map.values()].sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"));
}