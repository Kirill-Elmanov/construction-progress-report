import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authGuard } from "../middleware/authGuard.js";
import { Errors } from "../lib/errors.js";
import { getRequestAccess, canEditSection, loadReportWithAccess } from "../lib/access.js";
import { recordAudit } from "../lib/audit.js";
import { isSectionDraftLocked, mergeSectionDraft } from "../lib/section-workspaces.js";

/**
 * Данные недели — Ресурсы [Секция Ж, ТЗ 4.3]. Роль: Стройконтроль.
 *   GET /reports/:id/resources    Ресурсы отчёта + Δ за неделю
 *   PUT /reports/:id/resources    Автосохранение (одна запись, upsert)
 *
 * Особенности (ТЗ Секция Ж):
 *   • Ж1 itr ≤ 999, Ж2 workers ≤ 9999, Ж3 machinery ≤ 999 (все ≥ 0).
 *   • report_id UNIQUE → одна запись на отчёт (upsert).
 *   • Δ за неделю = тек − пред (относительно last finalized).
 */

const resourcesSchema = z.object({
  itr: z.number().int().min(0, "Не может быть отрицательным").max(999, "Максимум 999"), // Ж1
  workers: z.number().int().min(0, "Не может быть отрицательным").max(9999, "Максимум 9999"), // Ж2
  machinery: z.number().int().min(0, "Не может быть отрицательным").max(999, "Максимум 999"), // Ж3
  comment: z.string().max(300, "Максимум 300 символов").optional(), // Ж4
});

export async function resourcesRoutes(app: FastifyInstance) {
  // ── GET /reports/:id/resources ───────────────────────────────────
  app.get<{ Params: { id: string } }>(
    "/reports/:id/resources",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const row = await prisma.resourcesWeekly.findUnique({
        where: { reportId: report.id },
      });

      // Δ за неделю (относительно last finalized)
      const prev = await findPrevResources(report);

      return {
        itr: row?.itr ?? 0,
        workers: row?.workers ?? 0,
        machinery: row?.machinery ?? 0,
        comment: row?.comment ?? null,
        deltas: {
          itr: (row?.itr ?? 0) - (prev?.itr ?? 0), // Δ ИТР ▲/▼
          workers: (row?.workers ?? 0) - (prev?.workers ?? 0), // Δ Рабочие
          machinery: (row?.machinery ?? 0) - (prev?.machinery ?? 0), // Δ Техника
        },
      };
    }
  );

  // ── PUT /reports/:id/resources — автосохранение ──────────────────
  app.put<{ Params: { id: string }; Body: unknown }>(
    "/reports/:id/resources",
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

      if (report.status !== "draft") {
        return Errors.conflict(reply, "Отчёт финализирован — редактирование запрещено");
      }

      if (!canEditSection(request, report.projectId, "resources")) {
        return Errors.forbidden(reply, "Ваша ссылка-доступ не даёт права редактировать эту секцию");
      }
      if (await isSectionDraftLocked(report.projectId, "resources")) {
        return Errors.conflict(reply, "Раздел зафиксирован — сначала создайте корректировку");
      }

      const parsed = resourcesSchema.safeParse(request.body);
      if (!parsed.success) {
        return Errors.validation(reply, parsed.error.flatten());
      }
      const { itr, workers, machinery, comment } = parsed.data;

      // Upsert (report_id UNIQUE)
      const saved = await prisma.resourcesWeekly.upsert({
        where: { reportId: report.id },
        create: { reportId: report.id, itr, workers, machinery, comment: comment ?? null },
        update: { itr, workers, machinery, comment: comment ?? null },
      });

      // Δ за неделю
      const prev = await findPrevResources(report);
      const data = {
        itr: saved.itr,
        workers: saved.workers,
        machinery: saved.machinery,
        comment: saved.comment,
        deltas: {
          itr: saved.itr - (prev?.itr ?? 0),
          workers: saved.workers - (prev?.workers ?? 0),
          machinery: saved.machinery - (prev?.machinery ?? 0),
        },
      };

      await recordAudit(
        request, report.id, "resources", "save",
        `ИТР: ${itr}, рабочие: ${workers}, техника: ${machinery}`
      );
      await mergeSectionDraft(
        request,
        report.projectId,
        "resources",
        { resources: { itr, workers, machinery, comment: comment ?? null } },
        "Сохранён черновик привлечённых ресурсов"
      );

      return { data, warnings: [] };
    }
  );
}

// ── Хелпер: ресурсы из последнего finalized-отчёта (для Δ) ──
async function findPrevResources(report: { projectId: string; weekFriday: Date }) {
  const prevReport = await prisma.report.findFirst({
    where: {
      projectId: report.projectId,
      status: "finalized",
      weekFriday: { lt: report.weekFriday },
    },
    orderBy: { weekFriday: "desc" },
  });
  if (!prevReport) return null;
  return prisma.resourcesWeekly.findUnique({ where: { reportId: prevReport.id } });
}
