export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

// ISO → значение для <input type="date">
export function toInputDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('ru-RU').format(n) + ' ₽';
}

// ── ПР-2.5: разряды в числах ────────────────────────────────
/** 10086000000 → «10 086 000 000» (дробная часть сохраняется) */
export function fmtNum(v: number | string | null | undefined, maxFrac = 2): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: maxFrac });
}

/** Маска ввода: «10086000000» → «10 086 000 000», «230838,71» → «230 838,71» */
export function maskNumberInput(raw: string): string {
  const cleaned = raw.replace(/[^\d,.]/g, '').replace(/\./g, ',');
  const [int, ...frac] = cleaned.split(',');
  const grouped = (int || '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac.length ? `${grouped},${frac.join('').slice(0, 2)}` : grouped;
}

/** «10 086 000 000» → 10086000000 (для отправки на бэк) */
export function unmaskNumber(masked: string): number | null {
  const s = masked.replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ── ПР-3.1: маска телефона ──────────────────────────────────
/** «79231820017» / «89231820017» → «+7 923 182-00-17» */
export function maskPhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('8')) d = '7' + d.slice(1);
  if (!d.startsWith('7')) d = '7' + d;
  d = d.slice(0, 11);

  const p = d.slice(1);
  let out = '+7';
  if (p.length) out += ' ' + p.slice(0, 3);
  if (p.length > 3) out += ' ' + p.slice(3, 6);
  if (p.length > 6) out += '-' + p.slice(6, 8);
  if (p.length > 8) out += '-' + p.slice(8, 10);
  return out;
}

/** Только цифры — для хранения в БД */
export function unmaskPhone(masked: string): string {
  return masked.replace(/\D/g, '');
}

/** Дата + время: 21.08.2026, 14:35 */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}