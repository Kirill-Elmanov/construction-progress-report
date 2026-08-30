import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authGuard } from "../middleware/authGuard.js";
import { Errors } from "../lib/errors.js";
import { getRequestAccess, canEditSection, loadReportWithAccess } from "../lib/access.js";
import { recordAudit } from "../lib/audit.js";
import { isSectionDraftLocked, mergeSectionDraft } from "../lib/section-workspaces.js";

/**
 * Данные недели — Перечень работ за период [Секция З, ТЗ 4.3]. Роль: Стройконтроль.
 *   GET /reports/:id/worklog    Список работ отчёта
 *   PUT /reports/:id/worklog    Автосохранение целиком (массив, replace-all)
 *
 * Особенности (ТЗ Секция З):
 *   • Много строк на отчёт (не upsert!) → удаляем все + вставляем заново (как Г, В).
 *   • З1 contractor_id — обязателен (FK на справочник подрядчиков).
 *   • З2 section_id — опционален (FK на справочник разделов Б).
 *   • З6 volume_total ≥ З5 volume_week.
 *   • Предзаполнение пустое (каждую неделю новый перечень).
 */

// ПР-6.5: убраны ед. изм. и объёмы — только работа, подрядчик и % выполнения
const workRowSchema = z.object({
  contractorId: z.string().uuid("Некорректный ID подрядчика"), // Г1
  sectionId: z.string().uuid().nullable().optional(), // Г2
  description: z.string().min(1, "Опишите работы").max(1000, "Максимум 1000 символов"), // Г3
  percentDone: z.number().min(0).max(100).nullable().optional(), // Г4 % выполнения
});

const worklogSchema = z.array(workRowSchema);

export async function worklogRoutes(app: FastifyInstance) {
  // ── GET /reports/:id/worklog ─────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    "/reports/:id/worklog",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const rows = await prisma.workLog.findMany({
        where: { reportId: report.id },
        orderBy: { id: "asc" },
      });

      return {
        items: rows.map((r) => ({
          id: r.id,
          contractorId: r.contractorId,
          sectionId: r.sectionId,
          description: r.description,
          percentDone: r.percentDone == null ? null : Number(r.percentDone),
        })),
      };
    }
  );

  // ── PUT /reports/:id/worklog — автосохранение (replace-all) ──────
  app.put<{ Params: { id: string }; Body: unknown }>(
    "/reports/:id/worklog",
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

      if (!canEditSection(request, report.projectId, "worklog")) {
        return Errors.forbidden(reply, "Ваша ссылка-доступ не даёт права редактировать эту секцию");
      }
      if (await isSectionDraftLocked(report.projectId, "worklog")) {
        return Errors.conflict(reply, "Раздел зафиксирован — сначала создайте корректировку");
      }

      const parsed = worklogSchema.safeParse(request.body);
      if (!parsed.success) {
        return Errors.validation(reply, parsed.error.flatten());
      }
      const rows = parsed.data;

      // Проверка: подрядчики и разделы принадлежат этому проекту (защита FK)
      const contractorIds = [...new Set(rows.map((r) => r.contractorId))];
      const validContractors = await prisma.contractor.count({
        where: { id: { in: contractorIds }, projectId: report.projectId },
      });
      if (validContractors !== contractorIds.length) {
        return Errors.validation(reply, {
          formErrors: ["Один из подрядчиков не принадлежит этому проекту"],
          fieldErrors: {},
        });
      }

      // Replace-all в транзакции (как Г, В)
      await prisma.$transaction([
        prisma.workLog.deleteMany({ where: { reportId: report.id } }),
        ...(rows.length > 0
          ? [
              prisma.workLog.createMany({
                data: rows.map((r) => ({
                  reportId: report.id,
                  contractorId: r.contractorId,
                  sectionId: r.sectionId ?? null,
                  description: r.description,
                  percentDone: r.percentDone ?? null,
                })),
              }),
            ]
          : []),
      ]);

      const saved = await prisma.workLog.findMany({
        where: { reportId: report.id },
        orderBy: { id: "asc" },
      });

      const data = {
        items: saved.map((r) => ({
          id: r.id,
          contractorId: r.contractorId,
          sectionId: r.sectionId,
          description: r.description,
          percentDone: r.percentDone == null ? null : Number(r.percentDone),
        })),
      };

      // Правки v5: в неизменяемом снимке храним и читаемые названия.
      // Иначе PDF показывал технические UUID подрядчика и раздела.
      const [contractorRows, sectionRows] = await Promise.all([
        prisma.contractor.findMany({
          where: { id: { in: [...new Set(saved.map((row) => row.contractorId))] } },
          select: { id: true, name: true },
        }),
        prisma.section.findMany({
          where: { id: { in: saved.flatMap((row) => row.sectionId ? [row.sectionId] : []) } },
          select: { id: true, name: true },
        }),
      ]);
      const contractorNames = new Map(contractorRows.map((row) => [row.id, row.name]));
      const sectionNames = new Map(sectionRows.map((row) => [row.id, row.name]));

      await recordAudit(
        request, report.id, "worklog", "save",
        `Работ в перечне: ${rows.length}`
      );
      await mergeSectionDraft(
        request,
        report.projectId,
        "worklog",
        {
          worklog: data.items.map((item) => ({
            ...item,
            contractorName: contractorNames.get(item.contractorId) ?? null,
            sectionName: item.sectionId ? sectionNames.get(item.sectionId) ?? null : null,
          })),
        },
        "Сохранён черновик перечня выполненных работ"
      );

      return { data, warnings: [] };
    }
  );
}
