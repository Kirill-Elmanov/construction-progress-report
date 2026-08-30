import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authGuard } from "../middleware/authGuard.js";
import { Errors } from "../lib/errors.js";
import { getRequestAccess, canEditSection, loadReportWithAccess } from "../lib/access.js";
import { recordAudit } from "../lib/audit.js";
import { isSectionDraftLocked, mergeSectionDraft } from "../lib/section-workspaces.js";
import { isRdSheetConfigured, loadRdSheetSummary } from "../lib/rd-sheet.js";

/**
 * Данные недели — Разработка РД [Секция В, ПР-6.4]. Роль: ГИП.
 * На MVP — ручной ввод, далее импорт из Google-таблицы.
 */

const rdSchema = z.object({
  volumesTotal: z.number().int().min(0).max(99999),
  handedToCustomer: z.number().int().min(0).max(99999),
  onReview: z.number().int().min(0).max(99999),
  issuedVpr: z.number().int().min(0).max(99999),
  inProgress: z.number().int().min(0).max(99999),
  withRemarks: z.number().int().min(0).max(99999),
});

const EMPTY = {
  volumesTotal: 0, handedToCustomer: 0, onReview: 0,
  issuedVpr: 0, inProgress: 0, withRemarks: 0,
};

export async function rdDevelopmentRoutes(app: FastifyInstance) {
  // ── GET /reports/:id/rd-development ──────────────────────────────
  app.get<{ Params: { id: string } }>(
    "/reports/:id/rd-development",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const [row, project] = await Promise.all([
        prisma.rdDevelopment.findUnique({ where: { reportId: report.id } }),
        prisma.project.findUnique({ where: { id: report.projectId }, select: { rdSheetUrl: true } }),
      ]);

      const prev = await findPrev(report);
      const cur = row ?? EMPTY;

      return {
        ...cur,
        automationConfigured: isRdSheetConfigured(project?.rdSheetUrl),
        deltas: {
          volumesTotal: prev ? cur.volumesTotal - prev.volumesTotal : 0,
          handedToCustomer: prev ? cur.handedToCustomer - prev.handedToCustomer : 0,
          issuedVpr: prev ? cur.issuedVpr - prev.issuedVpr : 0,
        },
      };
    }
  );

  // ── PUT /reports/:id/rd-development ──────────────────────────────
  app.put<{ Params: { id: string }; Body: unknown }>(
    "/reports/:id/rd-development",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      if (report.status !== "draft") {
        return Errors.conflict(reply, "Отчёт финализирован — редактирование запрещено");
      }

      if (!canEditSection(request, report.projectId, "rd")) {
        return Errors.forbidden(reply, "Ваша ссылка-доступ не даёт права редактировать эту секцию");
      }
      if (await isSectionDraftLocked(report.projectId, "rd")) {
        return Errors.conflict(reply, "Раздел зафиксирован — сначала создайте корректировку");
      }

      const parsed = rdSchema.safeParse(request.body);
      if (!parsed.success) return Errors.validation(reply, parsed.error.flatten());
      const d = parsed.data;

      // Мягкие проверки (не блокируют)
      const warnings: string[] = [];
      if (d.volumesTotal > 0) {
        if (d.handedToCustomer > d.volumesTotal) {
          warnings.push("«Передано Тех. Заказчику» больше, чем «Всего томов»");
        }
        if (d.issuedVpr > d.volumesTotal) {
          warnings.push("«Выдано ВПР» больше, чем «Всего томов»");
        }
        // «Передано» уже включает «На рассмотрении» и «Выдано ВПР»,
        // поэтому эти показатели намеренно пересекаются и не суммируются.
      }

      const prev = await findPrev(report);
      if (prev && d.volumesTotal < prev.volumesTotal) {
        warnings.push(`«Всего томов» (${d.volumesTotal}) меньше прошлой недели (${prev.volumesTotal})`);
      }

      const saved = await prisma.rdDevelopment.upsert({
        where: { reportId: report.id },
        create: { reportId: report.id, ...d },
        update: d,
      });

      await recordAudit(
        request, report.id, "rd", "save",
        `Томов всего: ${saved.volumesTotal}, передано Тех. Заказчику: ${saved.handedToCustomer}`
      );
      await mergeSectionDraft(
        request,
        report.projectId,
        "rd",
        { rdDevelopment: d },
        "Сохранён черновик разработки РД"
      );

      return {
        data: {
          ...saved,
          deltas: {
            volumesTotal: prev ? saved.volumesTotal - prev.volumesTotal : 0,
            handedToCustomer: prev ? saved.handedToCustomer - prev.handedToCustomer : 0,
            issuedVpr: prev ? saved.issuedVpr - prev.issuedVpr : 0,
          },
        },
        warnings,
      };
    }
  );

  // ── POST /reports/:id/rd-development/refresh — Google Sheets ───
  app.post<{ Params: { id: string } }>(
    "/reports/:id/rd-development/refresh",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");
      if (report.status !== "draft") return Errors.conflict(reply, "Отчёт финализирован — актуализация запрещена");
      if (!canEditSection(request, report.projectId, "rd")) {
        return Errors.forbidden(reply, "Нет права актуализировать секцию В");
      }
      if (await isSectionDraftLocked(report.projectId, "rd")) {
        return Errors.conflict(reply, "Раздел зафиксирован — сначала создайте корректировку");
      }

      let data;
      try {
        const project = await prisma.project.findUnique({
          where: { id: report.projectId }, select: { rdSheetUrl: true },
        });
        data = await loadRdSheetSummary(project?.rdSheetUrl, { forceRefresh: true });
      } catch (error) {
        request.log.warn({ error }, "Не удалось актуализировать реестр РД");
        return Errors.conflict(reply, error instanceof Error ? error.message : "Google-таблица недоступна");
      }
      const historical = await prisma.rdDevelopment.findFirst({
        where: {
          reportId: { not: report.id },
          volumesTotal: { gte: 10 },
          report: { projectId: report.projectId },
        },
        orderBy: { report: { weekFriday: "desc" } },
        select: { volumesTotal: true },
      });
      if (historical && data.volumesTotal < Math.floor(historical.volumesTotal * 0.25)) {
        request.log.warn({ current: data.volumesTotal, historical: historical.volumesTotal }, "Google Sheets вернул подозрительно мало строк РД");
        return Errors.conflict(
          reply,
          `Google Sheets вернул только ${data.volumesTotal} комплектов вместо примерно ${historical.volumesTotal}. Данные не сохранены; повторите актуализацию`,
        );
      }
      const prev = await findPrev(report);
      const saved = await prisma.rdDevelopment.upsert({
        where: { reportId: report.id }, create: { reportId: report.id, ...data }, update: data,
      });
      await recordAudit(request, report.id, "rd", "save", `Актуализировано из Google Sheets: ${saved.volumesTotal} томов`);
      await mergeSectionDraft(request, report.projectId, "rd", { rdDevelopment: { ...data } }, "Актуализировано из Google Sheets");
      return {
        data: {
          ...saved,
          automationConfigured: true,
          deltas: {
            volumesTotal: prev ? saved.volumesTotal - prev.volumesTotal : 0,
            handedToCustomer: prev ? saved.handedToCustomer - prev.handedToCustomer : 0,
            issuedVpr: prev ? saved.issuedVpr - prev.issuedVpr : 0,
          },
        },
        warnings: [],
        syncedAt: new Date(),
      };
    },
  );
}

async function findPrev(report: { projectId: string; weekFriday: Date }) {
  const prevReport = await prisma.report.findFirst({
    where: {
      projectId: report.projectId,
      status: "finalized",
      weekFriday: { lt: report.weekFriday },
    },
    orderBy: { weekFriday: "desc" },
  });
  if (!prevReport) return null;
  return prisma.rdDevelopment.findUnique({ where: { reportId: prevReport.id } });
}
