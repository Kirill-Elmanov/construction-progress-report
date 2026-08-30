import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authGuard } from "../middleware/authGuard.js";
import { Errors } from "../lib/errors.js";
import { getRequestAccess, getUserRequestAccess, canAccessProject } from "../lib/access.js";
import {
  getPurgeAt,
  purgeExpiredProjects,
  purgeProject,
  TRASH_TTL_DAYS,
} from "../lib/project-lifecycle.js";
import { DEFAULT_PLANR_ATTR_MAP, planrAttrMapSchema } from "../lib/planr-client.js";

/**
 * Проекты (ТЗ Секция А). Правки: ПР-1.6 (корзина), ПР-2.1/2.4/2.6, Т-2.
 */

const GLOBAL_ROLES = ["superadmin", "pzgd", "head_of_projects"];

// ПР-2.6: пороги светофора зашиты в код — из формы проекта убраны
const DELAY_YELLOW = 7;
const DELAY_RED = 14;

// Кто может РЕДАКТИРОВАТЬ карточку проекта
const PROJECT_EDIT_ROLES = [
  "superadmin", "pzgd", "head_of_projects", "gip", "gip_deputy", "coordinator",
];

// ПР-1.6: корзина — только суперадмин
const TRASH_ROLES = ["superadmin"];

function serializeProject(p: any) {
  return {
    ...p,
    budget: p.budget != null ? Number(p.budget) : null,
    tepArea: p.tepArea != null ? Number(p.tepArea) : null,
    technicalConditions: Array.isArray(p.technicalConditions) ? p.technicalConditions : [],
  };
}

// ── ПР-2.4: технические условия ────────────────────────────────────
const techConditionSchema = z.object({
  kind: z.string().min(1).max(100),
  org: z.string().min(1).max(300),
});

const googleSheetUrlSchema = z.string().url("Нужна полная ссылка Google Sheets").max(1000)
  .refine((value) => {
    try { return new URL(value).hostname === "docs.google.com"; } catch { return false; }
  }, "Разрешена ссылка только на docs.google.com");

const integrationFields = {
  rdSheetUrl: googleSheetUrlSchema.optional().nullable(),
  planrEpsId: z.string().uuid("EPS ID должен быть UUID").optional().nullable(),
  planrAttrMap: planrAttrMapSchema.optional().nullable(),
  scheduleReportMode: z.enum(["manual", "s_curve"]).optional(),
};

// ── Zod-схемы (Секция А) ───────────────────────────────────────────
const createProjectSchema = z
  .object({
    name: z.string().min(1, "Наименование обязательно").max(500),        // A1
    address: z.string().min(1, "Адрес обязателен").max(300),             // A2
    customer: z.string().min(1, "Заказчик обязателен").max(200),         // A3
    contractor: z.string().min(1, "Генподрядчик обязателен").max(200),   // A4
    techCustomer: z.string().min(1, "Технический заказчик обязателен").max(200),        // ПР-2.1
    generalDesigner: z.string().min(1, "Генеральный проектировщик обязателен").max(200),// ПР-2.1
    expertiseConclusion: z.string().max(500).optional().nullable(),      // ПР-2.1
    buildPermit: z.string().max(500).optional().nullable(),              // ПР-2.1
    technicalConditions: z.array(techConditionSchema).max(30).optional(),// ПР-2.4
    projectStage: z.string().max(50).optional().nullable(),              // Т-2
    planStart: z.coerce.date(),                                          // A5
    planFinish: z.coerce.date(),                                         // A6
    budget: z.coerce.number().int().positive("Бюджет должен быть > 0"),  // A7
    tepArea: z.coerce.number().positive().optional().nullable(),          // Площадь ЗУ
    tepPower: z.string().max(200).optional().nullable(),                  // Площадь возводимых объектов
    ...integrationFields,
  })
  .refine((d) => d.planStart <= d.planFinish, {
    message: "Дата начала не может быть позже даты окончания",
    path: ["planStart"],
  });

const updateProjectSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  address: z.string().min(1).max(300).optional(),
  customer: z.string().min(1).max(200).optional(),
  contractor: z.string().min(1).max(200).optional(),
  techCustomer: z.string().min(1).max(200).optional(),
  generalDesigner: z.string().min(1).max(200).optional(),
  expertiseConclusion: z.string().max(500).nullable().optional(),
  buildPermit: z.string().max(500).nullable().optional(),
  technicalConditions: z.array(techConditionSchema).max(30).optional(),
  projectStage: z.string().max(50).nullable().optional(),
  planStart: z.coerce.date().optional(),
  planFinish: z.coerce.date().optional(),
  budget: z.coerce.number().int().positive().optional(),
  tepArea: z.coerce.number().positive().nullable().optional(),
  tepPower: z.string().max(200).nullable().optional(),
  ...integrationFields,
});

export async function projectRoutes(app: FastifyInstance) {
  // ===================================================================
  // GET /projects — список активных (корзина исключена)
  // ===================================================================
  app.get("/projects", { preHandler: authGuard }, async (request, reply) => {
    const access = await getRequestAccess(request);
    if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

    const scopeWhere =
      access.accessScope === "global"
        ? { tenantId: access.tenantId }
        : { id: { in: access.projectIds } };

    const projects = await prisma.project.findMany({
      where: { ...scopeWhere, deletedAt: null }, // ПР-1.6
      orderBy: { createdAt: "desc" },
    });

    return projects.map(serializeProject);
  });

  // ===================================================================
  // GET /projects/trash — корзина (ПР-1.6, только суперадмин)
  // ===================================================================
  app.get("/projects/trash", { preHandler: authGuard }, async (request, reply) => {
    const access = await getUserRequestAccess(request);
    if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
    if (!TRASH_ROLES.includes(access.role)) {
      return Errors.forbidden(reply, "Корзина доступна только суперадмину");
    }

    // Ленивая автоочистка: старше 60 дней — удаляем безвозвратно
    const expired = await purgeExpiredProjects(access.tenantId);
    for (const item of expired) {
      request.log.info(
        `♻️ Автоочистка корзины (>${TRASH_TTL_DAYS} дн.): ${item.project.name} · файлов: ${item.result.filesRemoved}`
      );
    }

    const projects = await prisma.project.findMany({
      where: { tenantId: access.tenantId, deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
    });

    return projects.map((p) => ({
      ...serializeProject(p),
      purgeAt: p.deletedAt ? getPurgeAt(p.deletedAt) : null,
    }));
  });

  // ===================================================================
  // POST /projects — создать (только global-админы)
  // ===================================================================
  app.post("/projects", { preHandler: authGuard }, async (request, reply) => {
    const access = await getUserRequestAccess(request);
    if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

    if (!GLOBAL_ROLES.includes(access.role)) {
      return Errors.forbidden(reply, "Создавать проекты может только руководитель");
    }

    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.validation(reply, parsed.error.flatten().fieldErrors);
    }
    const d = parsed.data;
    if (access.role !== "superadmin"
      && (d.rdSheetUrl !== undefined || d.planrEpsId !== undefined
        || d.planrAttrMap !== undefined || d.scheduleReportMode !== undefined)) {
      return Errors.forbidden(reply, "Интеграции проекта настраивает только суперадмин");
    }

    const project = await prisma.project.create({
      data: {
        tenantId: access.tenantId,
        name: d.name,
        address: d.address,
        customer: d.customer,
        contractor: d.contractor,
        techCustomer: d.techCustomer,
        generalDesigner: d.generalDesigner,
        expertiseConclusion: d.expertiseConclusion ?? null,
        buildPermit: d.buildPermit ?? null,
        technicalConditions: d.technicalConditions ?? [],
        projectStage: d.projectStage ?? null,
        planStart: d.planStart,
        planFinish: d.planFinish,
        budget: BigInt(d.budget),
        tepArea: d.tepArea ?? null,
        tepPower: d.tepPower ?? null,
        rdSheetUrl: d.rdSheetUrl ?? null,
        planrEpsId: d.planrEpsId ?? null,
        planrAttrMap: d.planrEpsId ? { ...DEFAULT_PLANR_ATTR_MAP, ...(d.planrAttrMap ?? {}) } : undefined,
        scheduleReportMode: d.scheduleReportMode ?? "manual",
        // ПР-2.6: пороги фиксированы в коде, в БД пишем те же значения
        delayYellowDays: DELAY_YELLOW,
        delayRedDays: DELAY_RED,
        rdStages: ["ПД", "РД (выпуск 1)", "РД (выпуск 2)", "Рабочая документация завершена", "Корректировка"],
      },
    });

    request.log.info(`✅ Проект создан: ${project.name}`);
    reply.code(201);
    return serializeProject(project);
  });

  // ===================================================================
  // GET /projects/:id — один проект
  // ===================================================================
  app.get<{ Params: { id: string } }>(
    "/projects/:id",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const project = await prisma.project.findUnique({
        where: { id: request.params.id },
      });

      if (!project || project.tenantId !== access.tenantId || project.deletedAt) {
        return Errors.notFound(reply, "Проект не найден");
      }
      if (!canAccessProject(access, project.id)) {
        return Errors.forbidden(reply, "Нет доступа к этому проекту");
      }

      return serializeProject(project);
    }
  );

  // ===================================================================
  // PATCH /projects/:id — редактировать
  // ===================================================================
  app.patch<{ Params: { id: string } }>(
    "/projects/:id",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      if (!PROJECT_EDIT_ROLES.includes(access.role)) {
        return Errors.forbidden(reply, "Недостаточно прав для редактирования проекта");
      }

      const existing = await prisma.project.findUnique({
        where: { id: request.params.id },
      });
      if (!existing || existing.tenantId !== access.tenantId || existing.deletedAt) {
        return Errors.notFound(reply, "Проект не найден");
      }
      if (!canAccessProject(access, existing.id)) {
        return Errors.forbidden(reply, "Нет доступа к этому проекту");
      }

      const parsed = updateProjectSchema.safeParse(request.body);
      if (!parsed.success) {
        return Errors.validation(reply, parsed.error.flatten().fieldErrors);
      }
      const d = parsed.data;
      if (access.role !== "superadmin"
        && (d.rdSheetUrl !== undefined || d.planrEpsId !== undefined
          || d.planrAttrMap !== undefined || d.scheduleReportMode !== undefined)) {
        return Errors.forbidden(reply, "Интеграции проекта настраивает только суперадмин");
      }

      const start = d.planStart ?? existing.planStart;
      const finish = d.planFinish ?? existing.planFinish;
      if (start > finish) {
        return Errors.validation(reply, {
          planStart: ["Дата начала не может быть позже даты окончания"],
        });
      }

      const updated = await prisma.project.update({
        where: { id: existing.id },
        data: {
          ...(d.name !== undefined && { name: d.name }),
          ...(d.address !== undefined && { address: d.address }),
          ...(d.customer !== undefined && { customer: d.customer }),
          ...(d.contractor !== undefined && { contractor: d.contractor }),
          ...(d.techCustomer !== undefined && { techCustomer: d.techCustomer }),
          ...(d.generalDesigner !== undefined && { generalDesigner: d.generalDesigner }),
          ...(d.expertiseConclusion !== undefined && { expertiseConclusion: d.expertiseConclusion }),
          ...(d.buildPermit !== undefined && { buildPermit: d.buildPermit }),
          ...(d.technicalConditions !== undefined && { technicalConditions: d.technicalConditions }),
          ...(d.projectStage !== undefined && { projectStage: d.projectStage }),
          ...(d.planStart !== undefined && { planStart: d.planStart }),
          ...(d.planFinish !== undefined && { planFinish: d.planFinish }),
          ...(d.budget !== undefined && { budget: BigInt(d.budget) }),
          ...(d.tepArea !== undefined && { tepArea: d.tepArea }),
          ...(d.tepPower !== undefined && { tepPower: d.tepPower }),
          ...(d.rdSheetUrl !== undefined && { rdSheetUrl: d.rdSheetUrl }),
          ...(d.planrEpsId !== undefined && { planrEpsId: d.planrEpsId }),
          ...(d.planrAttrMap !== undefined && {
            planrAttrMap: d.planrAttrMap === null ? Prisma.DbNull : { ...DEFAULT_PLANR_ATTR_MAP, ...d.planrAttrMap },
          }),
          ...(d.scheduleReportMode !== undefined && { scheduleReportMode: d.scheduleReportMode }),
        },
      });

      request.log.info(`✏️ Проект обновлён: ${updated.name}`);
      return serializeProject(updated);
    }
  );

  // ===================================================================
  // DELETE /projects/:id?mode=trash|permanent — ПР-1.6
  //   mode=trash      → soft delete (корзина, восстановимо 60 дней)
  //   mode=permanent  → безвозвратно, вместе со всеми отчётами
  // Обычные роли: только если у проекта нет отчётов.
  // Суперадмин: любой режим без ограничений.
  // ===================================================================
  app.delete<{ Params: { id: string }; Querystring: { mode?: string } }>(
    "/projects/:id",
    { preHandler: authGuard },
    async (
      request,
      reply
    ) => {
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      if (!PROJECT_EDIT_ROLES.includes(access.role)) {
        return Errors.forbidden(reply, "Удалять проекты может только руководитель");
      }

      const existing = await prisma.project.findUnique({
        where: { id: request.params.id },
      });
      if (!existing || existing.tenantId !== access.tenantId) {
        return Errors.notFound(reply, "Проект не найден");
      }

      const isSuperadmin = TRASH_ROLES.includes(access.role);
      const mode = request.query.mode === "permanent" ? "permanent" : "trash";

      // Не-суперадмин: старое поведение — нельзя удалить проект с отчётами
      if (!isSuperadmin) {
        const reportsCount = await prisma.report.count({
          where: { projectId: existing.id },
        });
        if (reportsCount > 0) {
          return Errors.forbidden(
            reply,
            `Нельзя удалить: у проекта есть отчёты (${reportsCount}). Сначала удалите их или обратитесь к суперадмину.`
          );
        }
        await purgeProject(existing.id);
        request.log.info(`🗑️ Проект удалён: ${existing.name}`);
        return { success: true, mode: "permanent" };
      }

      // Суперадмин
      if (mode === "permanent") {
        // Каскад по схеме удалит отчёты, разделы, фото-записи
        const purged = await purgeProject(existing.id);
        request.log.info(`🔥 Проект удалён БЕЗВОЗВРАТНО: ${existing.name}`);
        return { success: true, mode: "permanent", filesRemoved: purged.filesRemoved };
      }

      await prisma.project.update({
        where: { id: existing.id },
        data: { deletedAt: new Date(), deletedBy: access.id },
      });
      request.log.info(`🗑️➡️♻️ Проект в корзине: ${existing.name}`);
      return { success: true, mode: "trash" };
    }
  );

  // ===================================================================
  // POST /projects/:id/restore — восстановить из корзины (ПР-1.6)
  // ===================================================================
  app.post<{ Params: { id: string } }>(
    "/projects/:id/restore",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
      if (!TRASH_ROLES.includes(access.role)) {
        return Errors.forbidden(reply, "Восстанавливать проекты может только суперадмин");
      }

      const existing = await prisma.project.findUnique({
        where: { id: request.params.id },
      });
      if (!existing || existing.tenantId !== access.tenantId) {
        return Errors.notFound(reply, "Проект не найден");
      }
      if (!existing.deletedAt) {
        return Errors.validation(reply, { message: "Проект не находится в корзине" });
      }

      // Глубокое восстановление: связанные данные не удалялись — вернутся вместе с проектом
      const restored = await prisma.project.update({
        where: { id: existing.id },
        data: { deletedAt: null, deletedBy: null },
      });

      request.log.info(`♻️ Проект восстановлен: ${restored.name}`);
      return serializeProject(restored);
    }
  );
}
