/**
 * Утилиты дат (ТЗ: отчётная неделя = ПЯТНИЦА по МСК).
 * В БД храним DATE (без времени), считаем от МСК.
 */

/**
 * Возвращает дату ближайшей ПЯТНИЦЫ текущей недели (МСК).
 * Если сегодня сб/вс — берёт пятницу ТЕКУЩЕЙ недели (только что прошедшую).
 * Формат: Date с обнулённым временем (для @db.Date).
 */
export function getCurrentFriday(base: Date = new Date()): Date {
  // Приводим к МСК (UTC+3)
  const msk = new Date(base.getTime() + 3 * 60 * 60 * 1000);
  const day = msk.getUTCDay(); // 0=вс, 1=пн ... 5=пт, 6=сб

  // Смещение до пятницы (5)
  let diff = 5 - day;
  if (day === 6) diff = -1; // сб → пятница вчера
  if (day === 0) diff = -2; // вс → пятница позавчера

  const friday = new Date(msk);
  friday.setUTCDate(msk.getUTCDate() + diff);
  // Обнуляем время → чистая дата
  return new Date(Date.UTC(friday.getUTCFullYear(), friday.getUTCMonth(), friday.getUTCDate()));
}

/** Форматирование даты для логов (дд.мм.гггг) */
export function formatDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
}