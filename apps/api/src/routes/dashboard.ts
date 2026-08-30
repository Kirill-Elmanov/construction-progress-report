import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { authGuard } from "../middleware/authGuard.js";
import { Errors } from "../lib/errors.js";
import { getRequestAccess, loadProjectWithAccess } from "../lib/access.js";
import { buildSCurve, PROJECT_SCOPE_ID } from "../lib/s-curve.js";
import type { PlanrSnapshotRow } from "../lib/planr-client.js";

/**
 * Дашборд (ТЗ: ДИЗАЙН-ГАЙД ДАШБОРДА, БЛОКИ 1–5). Роль: ПЗГД + все с доступом.
 *   GET /projects/:id/dashboard            — по последнему отчёту
 *   GET /projects/:id/dashboard?reportId=  — по конкретной неделе
 */

const MS_PER_DAY = 86_400_000;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// ── формулы ТЗ 3.4 (зеркало packages/shared/src/calc) ────────────
function planPercentToday(planStart: Date, planFinish: Date, today: Date): number {
  const duration = planFinish.getTime() - planStart.getTime();
  if (duration <= 0) return 100;
  const elapsed = today.getTime() - planStart.getTime();
  return clamp((elapsed / duration) * 100, 0, 100);
}

function delayDays(factPercent: number, planStart: Date, planFinish: Date, today: Date): number {
  const planPct = planPercentToday(planStart, planFinish, today);
  const durationDays = (planFinish.getTime() - planStart.getTime()) / MS_PER_DAY;
  const delay = ((planPct - factPercent) / 100) * durationDays;
  return Math.max(0, delay);
}

function trafficLight(delay: number, yellow: number, red: number): "green" | "yellow" | "red" {
  if (delay < yellow) return "green";
  if (delay < red) return "yellow";
  return "red";
}

// номер недели ISO — для шапки «Неделя 48»
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7);
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));

export async function dashboardRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string }; Querystring: { reportId?: string } }>(
    "/projects/:id/dashboard",
    { preHandler: authGuard },
    async (
      request,
      reply
    ) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { project, denied } = await loadProjectWithAccess(request.params.id, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      // ── все отчёты проекта (для S-кривой и выбора недели) ──────
      const allReports = await prisma.report.findMany({
        where: { projectId: project.id },
        orderBy: [{ weekFriday: "asc" }, { version: "asc" }],
        select: { id: true, weekFriday: true, status: true, version: true },
      });

      if (allReports.length === 0) {
        return {
          project: {
            id: project.id,
            name: project.name,
            address: project.address,
            customer: project.customer,
            contractor: project.contractor,
          },
          report: null,
          weeks: [],
          kpi: null,
          sections: [],
          sCurve: [],
          issues: [],
          budget: null,
          resources: null,
        };
      }

      // Только последняя версия каждой недели
      const lastByWeek = new Map<string, (typeof allReports)[number]>();
      for (const r of allReports) {
        lastByWeek.set(r.weekFriday.toISOString().slice(0, 10), r);
      }
      const weekList = [...lastByWeek.values()].sort(
        (a, b) => a.weekFriday.getTime() - b.weekFriday.getTime()
      );

      // Выбранная неделя
      const current =
        (request.query.reportId
          ? weekList.find((r) => r.id === request.query.reportId)
          : undefined) ?? weekList[weekList.length - 1];

      if (!current) return Errors.notFound(reply, "Отчёт не найден");

      const currentIdx = weekList.findIndex((r) => r.id === current.id);
      const prev = currentIdx > 0 ? weekList[currentIdx - 1] : null;

      // ── данные текущей и прошлой недели ───────────────────────
      const [sections, progress, prevProgress, issues, presc, prevPresc, budget, prevBudget, resources, prevRes] =
        await Promise.all([
          prisma.section.findMany({
            where: { projectId: project.id },
            orderBy: { sortOrder: "asc" },
            include: { contractor: { select: { id: true, name: true } } },
          }),
          prisma.sectionProgress.findMany({ where: { reportId: current.id } }),
          prev ? prisma.sectionProgress.findMany({ where: { reportId: prev.id } }) : Promise.resolve([]),
          prisma.issue.findMany({
            where: { reportId: current.id, isArchived: false },
            orderBy: { createdAt: "asc" },
          }),
          prisma.prescription.findUnique({ where: { reportId: current.id } }),
          prev ? prisma.prescription.findUnique({ where: { reportId: prev.id } }) : Promise.resolve(null),
          prisma.budgetWeekly.findUnique({ where: { reportId: current.id } }),
          prev ? prisma.budgetWeekly.findUnique({ where: { reportId: prev.id } }) : Promise.resolve(null),
          prisma.resourcesWeekly.findUnique({ where: { reportId: current.id } }),
          prev ? prisma.resourcesWeekly.findUnique({ where: { reportId: prev.id } }) : Promise.resolve(null),
        ]);

      const today = current.weekFriday; // расчёты на отчётную пятницу
      
      // ПР-2.6 / Т-1: пороги зашиты в код, из карточки проекта убраны
      const thresholds = { yellow: 7, red: 14 };

      const progMap = new Map(progress.map((p) => [p.sectionId, p]));
      const prevProgMap = new Map(prevProgress.map((p) => [p.sectionId, p]));

      // ── БЛОК 3: таблица разделов + светофоры ──────────────────
      const sectionRows = sections.map((s) => {
        const p = progMap.get(s.id);
        const pct = num(p?.percentDone);
        const prevPct = prevProgMap.has(s.id) ? num(prevProgMap.get(s.id)?.percentDone) : null;
        const d = Math.round(delayDays(pct, s.planStart, s.planFinish, today));
        return {
          id: s.id,
          name: s.name,
          code: s.code,
          contractor: s.contractor?.name ?? null,
          percentDone: pct,
          weekDelta: prevPct == null ? pct : Math.round((pct - prevPct) * 100) / 100,
          delayDays: d,
          light: trafficLight(d, thresholds.yellow, thresholds.red),
          isCritical: p?.isCritical ?? false,
          planStart: s.planStart,
          planFinish: s.planFinish,
          factStart: p?.factStart ?? null,
          factFinish: p?.factFinish ?? null,
        };
      });

      const avg = (arr: number[]) =>
        arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0;

      let overallPercent = avg(sectionRows.map((r) => r.percentDone));
      let prevOverall = prev
        ? avg(sections.map((s) => (prevProgMap.has(s.id) ? num(prevProgMap.get(s.id)?.percentDone) : 0)))
        : 0;

      const maxDelay = sectionRows.length ? Math.max(...sectionRows.map((r) => r.delayDays)) : 0;

      // ── БЛОК 5: бюджет ────────────────────────────────────────
      const projectBudget = Number(project.budget ?? 0);
      const spent = Number(budget?.spentTotal ?? 0);
      const prevSpent = Number(prevBudget?.spentTotal ?? 0);
      const spentPercent = projectBudget > 0 ? Math.round((spent / projectBudget) * 1000) / 10 : 0;
      const prevSpentPercent = projectBudget > 0 ? Math.round((prevSpent / projectBudget) * 1000) / 10 : 0;

      // ── КПИ по проблемам ──────────────────────────────────────
      const openIssues = issues.filter((i) => i.status !== "green");
      const redCount = issues.filter((i) => i.status === "red").length;
      const yellowCount = issues.filter((i) => i.status === "yellow").length;

      // ── БЛОК 4: S-кривая план/факт по неделям ─────────────────
      const allProgress = await prisma.sectionProgress.findMany({
        where: { reportId: { in: weekList.map((r) => r.id) } },
        select: { reportId: true, sectionId: true, percentDone: true },
      });
      const byReport = new Map<string, number[]>();
      for (const p of allProgress) {
        const arr = byReport.get(p.reportId) ?? [];
        arr.push(num(p.percentDone));
        byReport.set(p.reportId, arr);
      }

      let sCurve: Array<{ week: string; weekFriday: Date | string; fact: number | null; plan: number | null; forecast?: number | null }> = weekList.map((r) => ({
        week: `${r.weekFriday.getUTCDate()}.${String(r.weekFriday.getUTCMonth() + 1).padStart(2, "0")}`,
        weekFriday: r.weekFriday,
        fact: avg(byReport.get(r.id) ?? []),
        plan:
          Math.round(planPercentToday(project.planStart, project.planFinish, r.weekFriday) * 10) / 10,
      }));

      // В режиме S-кривой дашборд и отчёт используют один и тот же снимок PLAN-R.
      if (project.scheduleReportMode === "s_curve") {
        const [storedRows, storedFacts] = await Promise.all([
          prisma.planrScheduleItem.findMany({ where: { projectId: project.id }, orderBy: { sortOrder: "asc" } }),
          prisma.planrProgressPoint.findMany({
            where: { projectId: project.id, scopeWbsId: PROJECT_SCOPE_ID }, orderBy: { asOfDate: "asc" },
          }),
        ]);
        const planrRows: PlanrSnapshotRow[] = storedRows.map((row) => ({
          wbsId: row.wbsId, parentWbsId: row.parentWbsId, code: row.code, name: row.name, nodeType: row.nodeType,
          targetStart: row.targetStart?.toISOString().slice(0, 10) ?? null,
          targetFinish: row.targetFinish?.toISOString().slice(0, 10) ?? null,
          forecastStart: row.forecastStart?.toISOString().slice(0, 10) ?? null,
          forecastFinish: row.forecastFinish?.toISOString().slice(0, 10) ?? null,
          percentDone: row.percentDone == null ? null : Number(row.percentDone), sortOrder: row.sortOrder,
        }));
        if (planrRows.length) {
          const curve = buildSCurve(planrRows, PROJECT_SCOPE_ID, storedFacts.map((point) => ({
            date: point.asOfDate.toISOString().slice(0, 10), percent: Number(point.percentDone),
          })), current.weekFriday.toISOString().slice(0, 10));
          sCurve = curve.map((point) => ({
            week: point.label, weekFriday: point.date,
            plan: point.plan, fact: point.fact, forecast: point.forecast,
          }));
          const actual = curve.flatMap((point) => point.fact == null ? [] : [point.fact]);
          if (actual.length) {
            overallPercent = actual[actual.length - 1];
            prevOverall = actual.length > 1 ? actual[actual.length - 2] : 0;
          }
        }
      }

      return {
        // ── БЛОК 1: шапка ────────────────────────────────────────
        project: {
          id: project.id,
          name: project.name,
          address: project.address,
          customer: project.customer,
          contractor: project.contractor,
          budget: projectBudget,
          planStart: project.planStart,
          planFinish: project.planFinish,
          delayYellowDays: thresholds.yellow,
          delayRedDays: thresholds.red,
        },
        report: {
          id: current.id,
          weekFriday: current.weekFriday,
          weekNumber: isoWeek(current.weekFriday),
          status: current.status,
          version: current.version,
        },
        weeks: weekList.map((r) => ({
          id: r.id,
          weekFriday: r.weekFriday,
          weekNumber: isoWeek(r.weekFriday),
          status: r.status,
        })),

        // ── БЛОК 2: KPI ─────────────────────────────────────────
        kpi: {
          overallPercent,
          overallDelta: prev ? Math.round((overallPercent - prevOverall) * 10) / 10 : overallPercent,
          spentPercent,
          spentDelta: prev ? Math.round((spentPercent - prevSpentPercent) * 10) / 10 : spentPercent,
          maxDelayDays: maxDelay,
          delayLight: trafficLight(maxDelay, thresholds.yellow, thresholds.red),
          openIssues: openIssues.length,
          redIssues: redCount,
          yellowIssues: yellowCount,
          prescriptionsOpen: presc ? presc.issuedTotal - presc.resolvedTotal : 0,
          prescriptionsIssuedWeek: presc
            ? presc.issuedTotal - (prevPresc?.issuedTotal ?? 0)
            : 0,
        },

        sections: sectionRows,
        sCurve,

        // ── БЛОК 5: проблематика ─────────────────────────────────
        issues: issues.map((i) => ({
          id: i.id,
          description: i.description,
          status: i.status,
          action: i.action,
          responsible: i.responsible,
          dueDate: i.dueDate,
          resolvedDate: i.resolvedDate,
        })),

        budget: {
          projectBudget,
          spent,
          spentPercent,
          percentDelta: prev ? Math.round((spentPercent - prevSpentPercent) * 10) / 10 : spentPercent,
          spentWeek: spent - prevSpent,
          rdStage: budget?.rdStage ?? null,
        },

        // ── БЛОК 6: ресурсы ──────────────────────────────────────
        resources: resources
          ? {
              itr: resources.itr,
              workers: resources.workers,
              machinery: resources.machinery,
              deltas: {
                itr: resources.itr - (prevRes?.itr ?? resources.itr),
                workers: resources.workers - (prevRes?.workers ?? resources.workers),
                machinery: resources.machinery - (prevRes?.machinery ?? resources.machinery),
              },
            }
          : null,
      };
    }
  );
}
