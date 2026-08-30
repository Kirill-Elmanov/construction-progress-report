import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authGuard } from "../middleware/authGuard.js";
import { Errors } from "../lib/errors.js";
import { getRequestAccess, canEditSection, loadReportWithAccess } from "../lib/access.js";
import { recordAudit } from "../lib/audit.js";
import { isSectionDraftLocked, mergeSectionDraft } from "../lib/section-workspaces.js";

/**
 * Данные недели — Прогресс по разделам [Секция В, ТЗ 4.3].
 *   GET /reports/:id/progress    Прогресс всех разделов отчёта
 *   PUT /reports/:id/progress    Автосохранение секции целиком (массив)
 */

// ── Схема одной строки прогресса (Секция В) ────────────────────────
const progressRowSchema = z.object({
  sectionId: z.string().uuid(), // В2 (ссылка на справочник Б)
  percentDone: z.number().min(0, "Мин. 0%").max(100, "Макс. 100%"), // В3
  factStart: z.string().optional().nullable(), // В4
  factFinish: z.string().optional().nullable(), // В5
  comment: z.string().max(500).optional().nullable(), // В6
  isCritical: z.boolean().optional(), // В7
});

// PUT принимает массив (автосохранение всей секции)
const progressPutSchema = z.object({
  progress: z.array(progressRowSchema),
});

// ── Роуты ──────────────────────────────────────────────────────────
export async function progressRoutes(app: FastifyInstance) {
  // GET /reports/:id/progress — прогресс всех разделов отчёта
  app.get<{ Params: { id: string } }>(
    "/reports/:id/progress",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const progress = await prisma.sectionProgress.findMany({
        where: { reportId: report.id },
        include: {
          section: {
            select: {
              id: true,
              name: true,
              code: true,
              sortOrder: true,
              planStart: true,
              planFinish: true,
            },
          },
        },
      });

      // Сортируем по порядку разделов (Б3)
      progress.sort((a, b) => a.section.sortOrder - b.section.sortOrder);

      // Decimal → number для JSON
      return progress.map((p) => ({
        ...p,
        percentDone: Number(p.percentDone),
      }));
    }
  );

  // PUT /reports/:id/progress — автосохранение секции целиком (массив)
  app.put<{ Params: { id: string }; Body: unknown }>(
    "/reports/:id/progress",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      // ТЗ: редактировать можно только черновик
      if (report.status === "finalized") {
        return Errors.conflict(
          reply,
          "Отчёт финализирован — редактирование запрещено. Создайте корректировку."
        );
      }

      if (!canEditSection(request, report.projectId, "worklog")) {
        return Errors.forbidden(reply, "Ваша ссылка-доступ не даёт права редактировать эту секцию");
      }
      if (await isSectionDraftLocked(report.projectId, "worklog")) {
        return Errors.conflict(reply, "Раздел зафиксирован — сначала создайте корректировку");
      }

      const parsed = progressPutSchema.safeParse(request.body);
      if (!parsed.success) {
        return Errors.validation(reply, { message: parsed.error.issues[0].message });
      }
      const rows = parsed.data.progress;

      // Проверяем: все sectionId принадлежат проекту отчёта
      const projectSections = await prisma.section.findMany({
        where: { projectId: report.project.id },
        select: { id: true },
      });
      const validSectionIds = new Set(projectSections.map((s) => s.id));
      for (const row of rows) {
        if (!validSectionIds.has(row.sectionId)) {
          return Errors.validation(reply, {
            message: `Раздел ${row.sectionId} не принадлежит этому проекту`,
          });
        }
      }

      // ── WARNINGS: сравнение с прошлой неделей (ТЗ п.4) ──────────
      // Ищем последний finalized-отчёт этого проекта (предзаполнение)
      const warnings: Array<{ sectionId: string; field: string; message: string }> = [];

      const lastFinalized = await prisma.report.findFirst({
        where: {
          projectId: report.project.id,
          status: "finalized",
          id: { not: report.id },
        },
        orderBy: { weekFriday: "desc" },
      });

      if (lastFinalized) {
        const prevProgress = await prisma.sectionProgress.findMany({
          where: { reportId: lastFinalized.id },
          select: { sectionId: true, percentDone: true },
        });
        const prevMap = new Map(prevProgress.map((p) => [p.sectionId, Number(p.percentDone)]));

        for (const row of rows) {
          const prev = prevMap.get(row.sectionId);
          // В3 меньше прошлой недели → warning (НЕ блок!)
          if (prev !== undefined && row.percentDone < prev) {
            warnings.push({
              sectionId: row.sectionId,
              field: "percentDone",
              message: `Значение (${row.percentDone}%) меньше прошлой недели (${prev}%). Уверены?`,
            });
          }
        }
      }

      // ── Сохранение целиком: delete + create в транзакции ────────
      await prisma.$transaction([
        prisma.sectionProgress.deleteMany({ where: { reportId: report.id } }),
        ...rows.map((row) =>
          prisma.sectionProgress.create({
            data: {
              reportId: report.id,
              sectionId: row.sectionId,
              percentDone: row.percentDone,
              factStart: row.factStart ? new Date(row.factStart) : null,
              factFinish: row.factFinish ? new Date(row.factFinish) : null,
              comment: row.comment ?? null,
              isCritical: row.isCritical ?? false,
            },
          })
        ),
        // Правки v3: после проверки руководителем сохраняем актуальное
        // значение и в карточке работы для следующего отчётного периода.
        ...rows.map((row) =>
          prisma.section.update({
            where: { id: row.sectionId },
            data: {
              percentDone: row.percentDone,
              factStart: row.factStart ? new Date(row.factStart) : null,
              factFinish: row.factFinish ? new Date(row.factFinish) : null,
            },
          })
        ),
      ]);

      request.log.info(
        `💾 Прогресс сохранён: ${rows.length} разделов (отчёт ${report.id}, warnings: ${warnings.length})`
      );

      // ТЗ п.4: { data, warnings } — фронт покажет жёлтый баннер
      const saved = await prisma.sectionProgress.findMany({
        where: { reportId: report.id },
      });
      await recordAudit(
        request, report.id, "worklog", "save",
        `Обновлён прогресс по ${rows.length} разделам`
      );
      await mergeSectionDraft(
        request,
        report.project.id,
        "worklog",
        {
          progress: saved.map((row) => ({
            id: row.id,
            sectionId: row.sectionId,
            percentDone: Number(row.percentDone),
            factStart: row.factStart?.toISOString().slice(0, 10) ?? null,
            factFinish: row.factFinish?.toISOString().slice(0, 10) ?? null,
            comment: row.comment,
            isCritical: row.isCritical,
          })),
        },
        "Сохранён черновик прогресса работ"
      );

      return {
        data: saved.map((p) => ({ ...p, percentDone: Number(p.percentDone) })),
        warnings,
      };
    }
  );
}
