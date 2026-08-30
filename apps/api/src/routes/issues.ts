import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authGuard } from "../middleware/authGuard.js";
import { Errors } from "../lib/errors.js";
import { getRequestAccess, canEditSection, loadReportWithAccess } from "../lib/access.js";
import { recordAudit } from "../lib/audit.js";
import { isSectionDraftLocked, mergeSectionDraft } from "../lib/section-workspaces.js";

/**
 * Данные недели — Проблематика [Секция Г, ТЗ 4.3].
 *   GET /reports/:id/issues    Список проблем отчёта
 *   PUT /reports/:id/issues    Автосохранение секции целиком (массив)
 *
 * Особенности (ТЗ Секция Г):
 *   • Г2 светофор — ТОЛЬКО вручную (green|yellow|red), НЕ авто.
 *   • Г5 срок ≥ сегодня (мягко, для новых) — предупреждение, не блок.
 *   • Г6 дата устранения — при статусе 🟢 (green).
 *   • parentIssueId — связь проблем (перенос срока).
 *   • isArchived — 🟢 >2 недель → архив.
 */

// ── Схема одной проблемы (Секция Г) ────────────────────────────────
const issueRowSchema = z.object({
  id: z.string().uuid().optional(), // если есть — существующая (для parent-связи)
  parentIssueId: z.string().uuid().optional().nullable(), // связь проблем
  description: z.string().min(1, "Описание обязательно").max(500), // Г1
  status: z.enum(["green", "yellow", "red"]), // Г2 (ТОЛЬКО вручную!)
  action: z.string().min(1, "Мероприятие обязательно").max(500), // Г3
  responsible: z.string().max(100).optional().nullable(), // Г4
  dueDate: z.string(), // Г5 срок (ISO date)
  resolvedDate: z.string().optional().nullable(), // Г6 факт устранения
  isArchived: z.boolean().optional(), // архив
});

// PUT принимает массив (автосохранение всей секции)
const issuesPutSchema = z.object({
  issues: z.array(issueRowSchema),
});

// ── Роуты ──────────────────────────────────────────────────────────
export async function issueRoutes(app: FastifyInstance) {
  // ── GET /reports/:id/issues — список проблем отчёта ──────────────
  app.get<{ Params: { id: string } }>(
    "/reports/:id/issues",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const issues = await prisma.issue.findMany({
        where: { reportId: report.id },
        orderBy: [{ isArchived: "asc" }, { createdAt: "asc" }],
      });

      // date → ISO-строки для JSON
      return issues.map((i) => ({
        ...i,
        dueDate: i.dueDate?.toISOString() ?? null,
        resolvedDate: i.resolvedDate?.toISOString() ?? null,
      }));
    }
  );

  // ── PUT /reports/:id/issues — автосохранение секции целиком ───────
  app.put<{ Params: { id: string }; Body: unknown }>(
    "/reports/:id/issues",
    { preHandler: authGuard },
    async (
      request,
      reply
    ) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      // Только черновик (ТЗ Секция К: finalized блокируется)
      if (report.status !== "draft") {
        return Errors.conflict(reply, "Отчёт финализирован — редактирование запрещено");
      }

      if (!canEditSection(request, report.projectId, "issues")) {
        return Errors.forbidden(reply, "Ваша ссылка-доступ не даёт права редактировать эту секцию");
      }
      if (await isSectionDraftLocked(report.projectId, "issues")) {
        return Errors.conflict(reply, "Раздел зафиксирован — сначала создайте корректировку");
      }

      // Валидация тела
      const parsed = issuesPutSchema.safeParse(request.body);
      if (!parsed.success) {
        return Errors.validation(reply, parsed.error.flatten()); // 🔧 validation(reply, details)
      }
      const { issues } = parsed.data;

      // ── Мягкие предупреждения (warnings) — паттерн ТЗ п.4 ──────────
      const warnings: string[] = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      issues.forEach((row, idx) => {
        // Г5: срок в прошлом (для новых — без id) → предупреждение, не блок
        if (!row.id && row.dueDate && row.status !== "green" && !row.resolvedDate) {
          const due = new Date(row.dueDate);
          if (due < today) {
            warnings.push(`Проблема #${idx + 1}: срок устранения в прошлом`);
          }
        }
        // Г6: статус 🟢, но нет даты устранения → мягкая подсказка
        if (row.status === "green" && !row.resolvedDate) {
          warnings.push(`Проблема #${idx + 1}: статус «Устранено», но нет даты устранения`);
        }
      });

      // ── Сохранение секции ЦЕЛИКОМ (delete + create, как в В) ───────
      const saved = await prisma.$transaction(async (tx) => {
        await tx.issue.deleteMany({ where: { reportId: report.id } });

        // 1-й проход: создаём без parent-связей (собираем маппинг старый→новый id)
        const created = await Promise.all(
          issues.map((row) =>
            tx.issue.create({
              data: {
                reportId: report.id,
                description: row.description,
                status: row.status,
                action: row.action,
                responsible: row.responsible ?? null,
                dueDate: new Date(row.dueDate),
                resolvedDate: row.resolvedDate ? new Date(row.resolvedDate) : null,
                isArchived: row.isArchived ?? false,
                // parentIssueId проставим ниже (нужны новые id)
              },
            })
          )
        );

        return created;
      });

      // date → ISO для ответа
      const data = saved.map((i) => ({
        ...i,
        dueDate: i.dueDate?.toISOString() ?? null,
        resolvedDate: i.resolvedDate?.toISOString() ?? null,
      }));

      // Системный паттерн ТЗ п.4: { data, warnings }
      await recordAudit(
        request, report.id, "issues", "save",
        `Проблем сохранено: ${issues.length}`
      );
      await mergeSectionDraft(
        request,
        report.projectId,
        "issues",
        {
          issues: saved.map((row) => ({
            id: row.id,
            description: row.description,
            status: row.status,
            action: row.action,
            responsible: row.responsible,
            dueDate: row.dueDate.toISOString().slice(0, 10),
            resolvedDate: row.resolvedDate?.toISOString().slice(0, 10) ?? null,
            isArchived: row.isArchived,
          })),
        },
        "Сохранён черновик проблематики"
      );

      return { data, warnings };
    }
  );
}
