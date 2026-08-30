import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authGuard } from "../middleware/authGuard.js";
import { Errors } from "../lib/errors.js";
import { getRequestAccess, canEditSection, loadReportWithAccess } from "../lib/access.js";
import { recordAudit } from "../lib/audit.js";
import { isSectionDraftLocked, mergeSectionDraft } from "../lib/section-workspaces.js";

/**
 * Данные недели — Предписания [Секция Д, ТЗ 4.3].
 *   GET /reports/:id/prescriptions    Предписания отчёта
 *   PUT /reports/:id/prescriptions    Автосохранение (одна запись, не массив)
 *
 * Особенности (ТЗ Секция Д):
 *   • Д1 issued_total — нарастающим итогом. Меньше прошлой → warning (не блок).
 *   • Д2 resolved_total — нарастающим. Валидация: ≤ Д1.
 *   • report_id UNIQUE → одна запись на отчёт (upsert).
 */

const prescriptionsSchema = z
  .object({
    issuedTotal: z.number().int().min(0, "Не может быть отрицательным"), // Д1
    resolvedTotal: z.number().int().min(0, "Не может быть отрицательным"), // Д2
  })
  .refine((d) => d.resolvedTotal <= d.issuedTotal, {
    message: "Устранено не может быть больше, чем выдано (Д2 ≤ Д1)",
    path: ["resolvedTotal"],
  });

export async function prescriptionRoutes(app: FastifyInstance) {
  // ── GET /reports/:id/prescriptions ───────────────────────────────
  app.get<{ Params: { id: string } }>(
    "/reports/:id/prescriptions",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const row = await prisma.prescription.findUnique({
        where: { reportId: report.id },
      });

      // Расчётные поля (на лету, не хранятся)
      const issued = row?.issuedTotal ?? 0;
      const resolved = row?.resolvedTotal ?? 0;

      // ПР-6.2: автоматическая статистика за последнюю неделю
      const prev = await findPrevPrescriptions(report);

      return {
        issuedTotal: issued,
        resolvedTotal: resolved,
        openTotal: issued - resolved,
        deltas: {
          // Правки v4: тот же принцип, что у ресурсов — если предыдущего
          // отчёта ещё нет, текущие значения считаются приростом от нуля.
          issued: issued - (prev?.issuedTotal ?? 0),
          resolved: resolved - (prev?.resolvedTotal ?? 0),
          open: (issued - resolved) -
            ((prev?.issuedTotal ?? 0) - (prev?.resolvedTotal ?? 0)),
        },
      };
    }
  );

  // ── PUT /reports/:id/prescriptions — автосохранение ──────────────
  app.put<{ Params: { id: string }; Body: unknown }>(
    "/reports/:id/prescriptions",
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

      if (!canEditSection(request, report.projectId, "prescriptions")) {
        return Errors.forbidden(reply, "Ваша ссылка-доступ не даёт права редактировать эту секцию");
      }
      if (await isSectionDraftLocked(report.projectId, "prescriptions")) {
        return Errors.conflict(reply, "Раздел зафиксирован — сначала создайте корректировку");
      }

      const parsed = prescriptionsSchema.safeParse(request.body);
      if (!parsed.success) {
        return Errors.validation(reply, parsed.error.flatten());
      }
      const { issuedTotal, resolvedTotal } = parsed.data;

      // ── Warning: меньше прошлой недели (нарастающим не должно падать) ──
      const warnings: string[] = [];
      const prev = await findPrevPrescriptions(report);
      if (prev) {
        if (issuedTotal < prev.issuedTotal) {
          warnings.push(
            `Выдано (${issuedTotal}) меньше прошлой недели (${prev.issuedTotal})`
          );
        }
        if (resolvedTotal < prev.resolvedTotal) {
          warnings.push(
            `Устранено (${resolvedTotal}) меньше прошлой недели (${prev.resolvedTotal})`
          );
        }
      }

      // Upsert (report_id UNIQUE — одна запись на отчёт)
      const saved = await prisma.prescription.upsert({
        where: { reportId: report.id },
        create: { reportId: report.id, issuedTotal, resolvedTotal },
        update: { issuedTotal, resolvedTotal },
      });

      const data = {
        issuedTotal: saved.issuedTotal,
        resolvedTotal: saved.resolvedTotal,
        openTotal: saved.issuedTotal - saved.resolvedTotal,
        deltas: {
          issued: saved.issuedTotal - (prev?.issuedTotal ?? 0),
          resolved: saved.resolvedTotal - (prev?.resolvedTotal ?? 0),
          open: (saved.issuedTotal - saved.resolvedTotal) -
            ((prev?.issuedTotal ?? 0) - (prev?.resolvedTotal ?? 0)),
        },
      };

      await recordAudit(
        request, report.id, "prescriptions", "save",
        `Выдано: ${issuedTotal}, устранено: ${resolvedTotal}`
      );
      await mergeSectionDraft(
        request,
        report.projectId,
        "prescriptions",
        { prescriptions: { issuedTotal, resolvedTotal } },
        "Сохранён черновик предписаний"
      );

      return { data, warnings };
    }
  );
}

// ── Хелпер: предписания из последнего finalized-отчёта (для warnings) ──
// Паттерн ТЗ 3.2: источник = последний finalized того же проекта
async function findPrevPrescriptions(report: { projectId: string; weekFriday: Date }) {
  const prevReport = await prisma.report.findFirst({
    where: {
      projectId: report.projectId,
      status: "finalized",
      weekFriday: { lt: report.weekFriday },
    },
    orderBy: { weekFriday: "desc" },
  });
  if (!prevReport) return null;
  return prisma.prescription.findUnique({ where: { reportId: prevReport.id } });
}
