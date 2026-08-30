import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authGuard } from "../middleware/authGuard.js";
import { Errors } from "../lib/errors.js";
import { getRequestAccess, canEditSection, loadReportWithAccess } from "../lib/access.js";
import { recordAudit } from "../lib/audit.js";
import { isSectionDraftLocked, mergeSectionDraft } from "../lib/section-workspaces.js";

/**
 * Данные недели — Бюджет [Секция Б, ПР-6.3]. Роль: ГИП.
 *   Б1 paidGp        — Оплачено ГП, ₽ (нарастающим)
 *   optionalFields    — дополнительные именованные показатели проекта
 *   Освоение = Б1 / A7 × 100%; дополнительные поля в расчёт не входят.
 *   Стадия РД убрана (ПР-6.4 → Project.projectStage)
 */

const budgetSchema = z.object({
  paidGp: z.number().int().min(0, "Не может быть отрицательным"), // Б1
  optionalFields: z.array(z.object({
    id: z.string().trim().min(1).max(64),
    label: z.string().trim().max(120),
    value: z.number().int().min(0, "Не может быть отрицательным").nullable(),
  })).max(10, "Можно добавить не более 10 показателей"),
});

type OptionalBudgetField = z.infer<typeof budgetSchema>["optionalFields"][number];

/** Безопасно читаем JSON и отбрасываем устаревшие или повреждённые элементы. */
function normalizeOptionalFields(value: unknown): OptionalBudgetField[] {
  const parsed = budgetSchema.shape.optionalFields.safeParse(value);
  return parsed.success ? parsed.data : [];
}

function calc(paid: number, budget: number) {
  return {
    paidGp: paid,
    spentTotal: paid,
    projectBudget: budget,
    spentPercent: budget > 0 ? Math.round((paid / budget) * 1000) / 10 : 0,
  };
}

export async function budgetRoutes(app: FastifyInstance) {
  // ── GET /reports/:id/budget ──────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    "/reports/:id/budget",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const row = await prisma.budgetWeekly.findUnique({
        where: { reportId: report.id },
      });

      const project = await prisma.project.findUnique({
        where: { id: report.projectId },
        select: { budget: true, projectStage: true },
      });
      const budget = Number(project?.budget ?? 0);

      const paid = Number(row?.paidGp ?? 0);
      const optionalFields = normalizeOptionalFields(row?.optionalFields ?? []);

      // Δ за неделю (ПР-6.2, тот же паттерн что в ресурсах)
      const prev = await findPrevBudget(report);
      return {
        ...calc(paid, budget),
        optionalFields,
        projectStage: project?.projectStage ?? null, // ПР-6.4 — только для отображения
        deltas: {
          paidGp: prev ? paid - Number(prev.paidGp) : 0,
        },
      };
    }
  );

  // ── PUT /reports/:id/budget ──────────────────────────────────────
  app.put<{ Params: { id: string }; Body: unknown }>(
    "/reports/:id/budget",
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

      if (!canEditSection(request, report.projectId, "budget")) {
        return Errors.forbidden(reply, "Ваша ссылка-доступ не даёт права редактировать эту секцию");
      }
      if (await isSectionDraftLocked(report.projectId, "budget")) {
        return Errors.conflict(reply, "Раздел зафиксирован — сначала создайте корректировку");
      }

      const parsed = budgetSchema.safeParse(request.body);
      if (!parsed.success) return Errors.validation(reply, parsed.error.flatten());

      const { paidGp } = parsed.data;
      // Пустая добавленная строка не сохраняется; показатель с названием, но
      // без суммы остаётся в следующем отчёте как заготовка.
      const optionalFields = parsed.data.optionalFields.filter(
        (field) => field.label.length > 0,
      );

      const project = await prisma.project.findUnique({
        where: { id: report.projectId },
        select: { budget: true },
      });
      const budget = Number(project?.budget ?? 0);

      // Правки v4: только Б1 участвует в освоении и сравнивается с A7.
      if (budget > 0 && paidGp > budget) {
        return Errors.validation(reply, {
          formErrors: [
            `Оплачено ГП (${paidGp.toLocaleString("ru-RU")} ₽) больше бюджета проекта (${budget.toLocaleString("ru-RU")} ₽)`,
          ],
          fieldErrors: {},
        });
      }

      // Warnings: нарастающим не должно падать
      const warnings: string[] = [];
      const prev = await findPrevBudget(report);
      if (prev) {
        if (paidGp < Number(prev.paidGp)) {
          warnings.push(
            `Оплачено ГП (${paidGp.toLocaleString("ru-RU")} ₽) меньше прошлой недели (${Number(prev.paidGp).toLocaleString("ru-RU")} ₽)`
          );
        }
      }

      const saved = await prisma.budgetWeekly.upsert({
        where: { reportId: report.id },
        create: {
          reportId: report.id,
          paidGp: BigInt(paidGp),
          worksAccepted: 0n,
          spentTotal: BigInt(paidGp), // legacy-поле теперь равно единственному расчётному Б1
          comment: null,
          optionalFields,
        },
        update: {
          paidGp: BigInt(paidGp),
          worksAccepted: 0n,
          spentTotal: BigInt(paidGp),
          comment: null,
          optionalFields,
        },
      });

      await recordAudit(
        request, report.id, "budget", "save",
        `Оплачено ГП: ${paidGp.toLocaleString("ru-RU")} ₽, дополнительных показателей: ${optionalFields.length}`
      );
      // В финальный снимок попадают только полностью заполненные показатели.
      const printableFields = optionalFields
        .filter((field) => field.value !== null)
        .map(({ label, value }) => ({ label, value }));
      await mergeSectionDraft(
        request,
        report.projectId,
        "budget",
        { budget: { projectBudget: budget, paidGp, optionalFields: printableFields } },
        "Сохранён черновик бюджета"
      );

      return {
        data: {
          ...calc(Number(saved.paidGp), budget),
          optionalFields: normalizeOptionalFields(saved.optionalFields),
          deltas: {
            paidGp: prev ? paidGp - Number(prev.paidGp) : 0,
          },
        },
        warnings,
      };
    }
  );
}

async function findPrevBudget(report: { projectId: string; weekFriday: Date }) {
  const prevReport = await prisma.report.findFirst({
    where: {
      projectId: report.projectId,
      status: "finalized",
      weekFriday: { lt: report.weekFriday },
    },
    orderBy: { weekFriday: "desc" },
  });
  if (!prevReport) return null;
  return prisma.budgetWeekly.findUnique({ where: { reportId: prevReport.id } });
}
