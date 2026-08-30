// ═══════════════════════════════════════════════════════════
// Zod-схемы (single source фронт+бэк). Лимиты — из спецификации
// полей ТЗ (Секции А–И). «Меньше прошлой недели» → предупреждение,
// а НЕ блок (ТЗ *) — поэтому это НЕ в схемах, а в UI/сервисах.
// ═══════════════════════════════════════════════════════════

import { z } from 'zod';
import { ROLES, SECTIONS } from '../types/index.js';

const dateStr = z.coerce.date();

// ─── СЕКЦИЯ А. Карточка проекта ──────────────────────────────
export const projectSchema = z
  .object({
    name: z.string().min(1).max(200),          // A1
    address: z.string().min(1).max(300),       // A2
    customer: z.string().min(1).max(200),      // A3
    contractor: z.string().min(1).max(200),    // A4
    planStart: dateStr,                        // A5
    planFinish: dateStr,                       // A6
    budget: z.coerce.bigint().positive(),      // A7 (>0, целые рубли)
    tepArea: z.coerce.number().positive().optional(),   // A8
    tepPower: z.string().max(200).optional(),           // A9
    tepExtra: z                                          // A10 ≤10 строк
      .array(z.object({ key: z.string().max(100), value: z.string().max(200) }))
      .max(10)
      .optional(),
    delayYellowDays: z.number().int().positive().default(5),  // A12
    delayRedDays: z.number().int().positive().default(14),    // A12
    rdStages: z.array(z.string().min(1)).min(1).optional(),   // справочник Е2
  })
  .refine((d) => d.planStart <= d.planFinish, {
    message: 'Дата начала не может быть позже даты окончания', // A5/A6
    path: ['planStart'],
  })
  .refine((d) => d.delayYellowDays < d.delayRedDays, {
    message: 'Жёлтый порог должен быть меньше красного',        // A12
    path: ['delayYellowDays'],
  });

// ─── СЕКЦИЯ Б. Раздел работ ──────────────────────────────────
export const sectionSchema = z
  .object({
    name: z.string().min(1).max(150),        // Б1
    code: z.string().max(20).optional(),     // Б2
    contractorId: z.string().uuid().optional(), // Б4
    planStart: dateStr,                      // Б5
    planFinish: dateStr,                     // Б6
  })
  .refine((d) => d.planFinish > d.planStart, {
    message: 'Финиш раздела должен быть позже старта (Б6 > Б5)',
    path: ['planFinish'],
  });

// ─── СЕКЦИЯ В. Прогресс по разделу (элемент массива PUT) ────
export const progressItemSchema = z.object({
  sectionId: z.string().uuid(),                       // В2
  percentDone: z.coerce.number().min(0).max(100),     // В3
  factStart: dateStr.optional().nullable(),           // В4
  factFinish: dateStr.optional().nullable(),          // В5
  comment: z.string().max(500).optional().nullable(), // В6
});
export const progressPutSchema = z.array(progressItemSchema);

// ─── СЕКЦИЯ Г. Проблема (элемент массива PUT) ────────────────
export const issueItemSchema = z.object({
  id: z.string().uuid().optional(),          // есть id → обновление
  description: z.string().min(1).max(500),   // Г1
  status: z.enum(['red', 'yellow', 'green']),// Г2 — только вручную
  action: z.string().min(1).max(500),        // Г3
  responsible: z.string().max(100).optional().nullable(), // Г4
  dueDate: dateStr,                          // Г5 (≥сегодня для НОВЫХ — в сервисе)
  resolvedDate: dateStr.optional().nullable(), // Г6 (при 🟢)
});
export const issuesPutSchema = z.array(issueItemSchema);

// ─── СЕКЦИЯ Д. Предписания ───────────────────────────────────
export const prescriptionSchema = z
  .object({
    issuedTotal: z.coerce.number().int().min(0),   // Д1
    resolvedTotal: z.coerce.number().int().min(0), // Д2
  })
  .refine((d) => d.resolvedTotal <= d.issuedTotal, {
    message: 'Устранено не может быть больше выдано (Д2 ≤ Д1)',
    path: ['resolvedTotal'],
  });

// ─── СЕКЦИЯ Е. Бюджет ────────────────────────────────────────
export const budgetSchema = z.object({
  spentTotal: z.coerce.bigint().min(0n),     // Е1 (≤A7 — проверка в сервисе, там знаем A7)
  rdStage: z.string().min(1),                // Е2 (значение из projects.rd_stages)
  comment: z.string().max(300).optional().nullable(), // Е3
});

// ─── СЕКЦИЯ Ж. Ресурсы ───────────────────────────────────────
export const resourcesSchema = z.object({
  itr: z.coerce.number().int().min(0).max(999),      // Ж1
  workers: z.coerce.number().int().min(0).max(9999), // Ж2
  machinery: z.coerce.number().int().min(0).max(999),// Ж3
  comment: z.string().max(300).optional().nullable(),// Ж4
});

// ─── СЕКЦИЯ З. Строка перечня работ ──────────────────────────
export const workLogItemSchema = z
  .object({
    contractorId: z.string().uuid(),                    // З1
    sectionId: z.string().uuid().optional().nullable(), // З2
    description: z.string().min(1).max(1000),           // З3
    unit: z.string().max(50).optional().nullable(),     // З4
    volumeWeek: z.coerce.number().positive().optional().nullable(),  // З5
    volumeTotal: z.coerce.number().min(0).optional().nullable(),     // З6
  })
  .refine((d) => d.volumeWeek == null || d.volumeTotal == null || d.volumeTotal >= d.volumeWeek, {
    message: 'Нарастающий итог не может быть меньше объёма за неделю (З6 ≥ З5)',
    path: ['volumeTotal'],
  });
export const workLogPutSchema = z.array(workLogItemSchema);

// ─── СЕКЦИЯ И. Метаданные фото (файл — multipart, отдельно) ─
export const photoMetaSchema = z.object({
  caption: z.string().max(150).optional().nullable(),  // И2
  sectionId: z.string().uuid().optional().nullable(),  // И3
  shotDate: dateStr.optional().nullable(),             // И4
});

// ─── Ссылки-доступы ──────────────────────────────────────────
export const accessLinkSchema = z.object({
  role: z.enum(ROLES),
  allowedSections: z.array(z.enum(SECTIONS)),
  displayName: z.string().max(100).optional(),
});

export type ProjectInput = z.infer<typeof projectSchema>;
export type ProgressItem = z.infer<typeof progressItemSchema>;
export type IssueItem = z.infer<typeof issueItemSchema>;