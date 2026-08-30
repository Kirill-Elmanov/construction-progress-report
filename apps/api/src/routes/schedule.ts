import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authGuard } from "../middleware/authGuard.js";
import { Errors } from "../lib/errors.js";
import { canEditSection, getRequestAccess, loadProjectWithAccess } from "../lib/access.js";
import { manualScheduleSource } from "../lib/schedule-source.js";
import {
  isPlanrEnvironmentConfigured, isSCurveAttrMapConfigured, loadPlanrWbs,
  mapPlanrSnapshot, planrAttrMapSchema, type PlanrSnapshotRow,
} from "../lib/planr-client.js";
import { buildSCurve, PROJECT_SCOPE_ID, scopePercent, selectCurveScopes } from "../lib/s-curve.js";

/**
 * График работ за отчётный период [ПР-4.3].
 * Иерархия — через поле code («1.1» → «1.1.1» → «1.1.7.1»).
 *   GET /projects/:id/schedule
 *   PUT /projects/:id/schedule   — сохранение таблицы целиком
 */

const itemSchema = z.object({
  code: z.string().min(1, "Номер обязателен").max(30),
  name: z.string().min(1, "Наименование обязательно").max(500),
  planStart: z.string().optional().nullable(),
  planFinish: z.string().optional().nullable(),
  delayDays: z.number().int().min(-9999).max(9999).optional().nullable(),
  percentDone: z.number().min(0).max(100).optional().nullable(),
  weekGrowth: z.number().min(-100).max(100).optional().nullable(),
});

const putSchema = z.object({
  items: z.array(itemSchema).max(500),
});

/** Натуральная сортировка кодов: 1.2 < 1.10, 1.1.7.1 после 1.1.7 */
function codeKey(code: string): number[] {
  return code.split(".").map((p) => {
    const n = parseInt(p.replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  });
}
function compareCodes(a: string, b: string): number {
  const ka = codeKey(a);
  const kb = codeKey(b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (ka[i] ?? -1) - (kb[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

const num = (v: unknown) => (v == null ? null : Number(v));

export async function scheduleRoutes(app: FastifyInstance) {
  // GET /projects/:id/schedule
  app.get<{ Params: { id: string } }>(
    "/projects/:id/schedule",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { project, denied } = await loadProjectWithAccess(request.params.id, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const [items, latestReport] = await Promise.all([
        manualScheduleSource.load(project.id),
        prisma.report.findFirst({
          where: { projectId: project.id },
          orderBy: [{ weekFriday: "desc" }, { version: "desc" }],
          select: { weekFriday: true },
        }),
      ]);

      return {
        source: manualScheduleSource.kind,
        reportMode: project.scheduleReportMode,
        automationConfigured: Boolean(
          project.scheduleReportMode === "s_curve"
          && isPlanrEnvironmentConfigured()
          && project.planrEpsId
          && isSCurveAttrMapConfigured(project.planrAttrMap)
        ),
        asOfDate: latestReport?.weekFriday ?? null,
        items: items.map((i) => ({
          ...i,
          percentDone: num(i.percentDone),
          weekGrowth: num(i.weekGrowth),
          level: i.code.split(".").length, // уровень вложенности для отступа
        })),
      };
    }
  );

  // POST /projects/:id/schedule/refresh — импорт актуального снимка PLAN-R
  app.post<{ Params: { id: string } }>(
    "/projects/:id/schedule/refresh",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
      const { project, denied } = await loadProjectWithAccess(request.params.id, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");
      if (!canEditSection(request, project.id, "schedule")) {
        return Errors.forbidden(reply, "Нет права актуализировать график");
      }
      if (project.scheduleReportMode !== "s_curve") {
        return Errors.conflict(reply, "Для секции Д выбран режим ручной таблицы");
      }
      if (!project.planrEpsId || !isPlanrEnvironmentConfigured()) {
        return Errors.conflict(reply, "Для проекта не настроено подключение PLAN-R");
      }
      const parsedMap = planrAttrMapSchema.safeParse(project.planrAttrMap);
      if (!parsedMap.success || !isSCurveAttrMapConfigured(project.planrAttrMap)) {
        return Errors.conflict(reply, "Укажите UUID атрибутов «Целевой старт» и «Целевой финиш» в карточке проекта");
      }

      try {
        const nodes = await loadPlanrWbs(project.planrEpsId, parsedMap.data);
        const rows = mapPlanrSnapshot(nodes, parsedMap.data);
        if (!rows.length) return Errors.conflict(reply, "PLAN-R не вернул подходящих работ");
        if (!rows.some((row) => row.targetStart && row.targetFinish)) {
          return Errors.conflict(reply, "В ответе PLAN-R не найдены целевые даты — проверьте UUID целевого старта и финиша");
        }
        if (!rows.some((row) => row.forecastStart && row.forecastFinish)) {
          return Errors.conflict(reply, "В ответе PLAN-R не найдены расчётные даты «Старт / Финиш»");
        }
        if (!rows.some((row) => row.percentDone != null)) {
          return Errors.conflict(reply, "В ответе PLAN-R не найден расчётный процент выполнения");
        }
        const latestReport = await prisma.report.findFirst({
          where: { projectId: project.id }, orderBy: [{ weekFriday: "desc" }, { version: "desc" }],
          select: { weekFriday: true },
        });
        const asOfDate = latestReport?.weekFriday ?? new Date();
        const syncedAt = new Date();
        const scopes = selectCurveScopes(rows);
        await prisma.$transaction(async (tx) => {
          await tx.planrScheduleItem.deleteMany({ where: { projectId: project.id } });
          await tx.planrScheduleItem.createMany({
            data: rows.map((row) => ({
              projectId: project.id, wbsId: row.wbsId, parentWbsId: row.parentWbsId,
              code: row.code, name: row.name, nodeType: row.nodeType,
              targetStart: row.targetStart ? new Date(`${row.targetStart}T00:00:00Z`) : null,
              targetFinish: row.targetFinish ? new Date(`${row.targetFinish}T00:00:00Z`) : null,
              forecastStart: row.forecastStart ? new Date(`${row.forecastStart}T00:00:00Z`) : null,
              forecastFinish: row.forecastFinish ? new Date(`${row.forecastFinish}T00:00:00Z`) : null,
              percentDone: row.percentDone, sortOrder: row.sortOrder, syncedAt,
            })),
            // Дополнительная защита от нестабильной пагинации внешнего API.
            skipDuplicates: true,
          });
          for (const scope of scopes) {
            await tx.planrProgressPoint.upsert({
              where: { projectId_scopeWbsId_asOfDate: {
                projectId: project.id, scopeWbsId: scope.id, asOfDate,
              } },
              create: {
                projectId: project.id, scopeWbsId: scope.id, scopeName: scope.name,
                asOfDate, percentDone: scopePercent(rows, scope.id),
              },
              update: { scopeName: scope.name, percentDone: scopePercent(rows, scope.id), capturedAt: syncedAt },
            });
          }
        });
        request.log.info(`🔄 PLAN-R актуализирован: ${rows.length} строк (${project.name})`);
        return {
          source: "planr",
          syncedAt,
          rows: rows.length,
          scopes,
          warnings: [],
        };
      } catch (error) {
        request.log.warn({ err: error }, "Не удалось актуализировать график PLAN-R");
        const message = error instanceof Error ? error.message : "";
        const safeMessage = /^(PLAN-R|Не настроен|Токен PLAN-R|В ответе PLAN-R)/.test(message)
          ? message
          : "Не удалось сохранить данные PLAN-R. Повторите актуализацию";
        return Errors.conflict(reply, safeMessage);
      }
    },
  );

  // GET /projects/:id/s-curve — план, накопительный факт и прогноз PLAN-R.
  app.get<{ Params: { id: string }; Querystring: { scope?: string } }>(
    "/projects/:id/s-curve",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
      const { project, denied } = await loadProjectWithAccess(request.params.id, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const [storedRows, latestReport] = await Promise.all([
        prisma.planrScheduleItem.findMany({ where: { projectId: project.id }, orderBy: { sortOrder: "asc" } }),
        prisma.report.findFirst({
          where: { projectId: project.id }, orderBy: [{ weekFriday: "desc" }, { version: "desc" }],
          select: { weekFriday: true },
        }),
      ]);
      const rows: PlanrSnapshotRow[] = storedRows.map((row) => ({
        wbsId: row.wbsId, parentWbsId: row.parentWbsId, code: row.code, name: row.name,
        nodeType: row.nodeType,
        targetStart: row.targetStart?.toISOString().slice(0, 10) ?? null,
        targetFinish: row.targetFinish?.toISOString().slice(0, 10) ?? null,
        forecastStart: row.forecastStart?.toISOString().slice(0, 10) ?? null,
        forecastFinish: row.forecastFinish?.toISOString().slice(0, 10) ?? null,
        percentDone: row.percentDone == null ? null : Number(row.percentDone), sortOrder: row.sortOrder,
      }));
      const scopes = selectCurveScopes(rows);
      const selected = scopes.some((scope) => scope.id === request.query.scope)
        ? request.query.scope! : PROJECT_SCOPE_ID;
      const storedFacts = await prisma.planrProgressPoint.findMany({
        where: { projectId: project.id, scopeWbsId: selected }, orderBy: { asOfDate: "asc" },
      });
      const asOfDate = (latestReport?.weekFriday ?? new Date()).toISOString().slice(0, 10);
      return {
        reportMode: project.scheduleReportMode,
        automationConfigured: Boolean(project.planrEpsId
          && isPlanrEnvironmentConfigured() && isSCurveAttrMapConfigured(project.planrAttrMap)),
        scopes,
        selectedScope: selected,
        asOfDate,
        syncedAt: storedRows[0]?.syncedAt ?? null,
        points: rows.length ? buildSCurve(rows, selected, storedFacts.map((point) => ({
          date: point.asOfDate.toISOString().slice(0, 10), percent: Number(point.percentDone),
        })), asOfDate) : [],
      };
    },
  );

  // PUT /projects/:id/schedule — заменяем таблицу целиком
  app.put<{ Params: { id: string }; Body: unknown }>(
    "/projects/:id/schedule",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { project, denied } = await loadProjectWithAccess(request.params.id, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      // На MVP график вручную заполняет сотрудник КСП по выданному токену.
      // После интеграции PLAN-R эта проверка останется границей доступа к разделу.
      if (!canEditSection(request, project.id, "schedule")) {
        return Errors.forbidden(reply, "Ваша ссылка-доступ не даёт права редактировать график");
      }

      const parsed = putSchema.safeParse(request.body);
      if (!parsed.success) {
        return Errors.validation(reply, { message: parsed.error.issues[0].message });
      }

      const rows = [...parsed.data.items].sort((a, b) => compareCodes(a.code, b.code));

      // Мягкие предупреждения (не блокируют сохранение)
      const warnings: string[] = [];
      const seen = new Set<string>();
      for (const r of rows) {
        if (seen.has(r.code)) warnings.push(`Номер «${r.code}» встречается несколько раз`);
        seen.add(r.code);
        if (r.planStart && r.planFinish && new Date(r.planFinish) < new Date(r.planStart)) {
          warnings.push(`«${r.code} ${r.name}»: завершение раньше начала`);
        }
      }

      const saved = await manualScheduleSource.replace(project.id, rows);

      request.log.info(`📅 График работ сохранён: ${rows.length} строк (${project.name})`);

      return {
        data: saved.map((i) => ({
          ...i,
          percentDone: num(i.percentDone),
          weekGrowth: num(i.weekGrowth),
          level: i.code.split(".").length,
        })),
        warnings,
      };
    }
  );
}
