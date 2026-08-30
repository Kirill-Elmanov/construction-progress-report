import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authGuard } from "../middleware/authGuard.js";
import { Errors } from "../lib/errors.js";
import { canEditSection, getRequestAccess, getUserRequestAccess, loadProjectWithAccess } from "../lib/access.js"; // 🆕 хелперы

/**
 * Справочники проекта [Секция Б, ТЗ 4.3]...
 */

// ── Схемы валидации (Zod) ──────────────────────────────────────────
const sectionCreateSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(150), // Б1
  code: z.string().max(60).optional(), // Б2 — шифр комплекта РД
  contractorId: z.string().uuid().optional(), // Б4
  planStart: z.string(), // Б5 план начало
  planFinish: z.string(), // Б6 план окончание
  // ПР-4.1: фактические даты
  factStart: z.string().optional().nullable(),
  factFinish: z.string().optional().nullable(),
  percentDone: z.number().min(0).max(100).optional(), // Правки v3: вводит исполнитель
});

const sectionUpdateSchema = sectionCreateSchema.partial();

const reorderSchema = z.object({
  order: z.array(z.string().uuid()), // массив id разделов в новом порядке
});

const contractorCreateSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(200),
  contactPerson: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
});

const contractorUpdateSchema = contractorCreateSchema.partial();

// Проверка Б6 > Б5
function validateDates(start: string, finish: string): string | null {
  const s = new Date(start);
  const f = new Date(finish);
  if (f <= s) return "Плановый финиш (Б6) должен быть позже старта (Б5)";
  return null;
}

// ── Роуты ──────────────────────────────────────────────────────────
export async function sectionRoutes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════════════════════
  // РАЗДЕЛЫ РАБОТ (Section)
  // ═══════════════════════════════════════════════════════════════

  // GET /projects/:id/sections — список разделов
  app.get<{ Params: { id: string } }>(
    "/projects/:id/sections",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { project, denied } = await loadProjectWithAccess(request.params.id, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const sections = await prisma.section.findMany({
        where: { projectId: project.id },
        orderBy: { sortOrder: "asc" },
        include: { contractor: { select: { id: true, name: true } } },
      });

      return sections.map((s) => ({
        ...s,
        percentDone: Number(s.percentDone),
      }));
    }
  );

  // POST /projects/:id/sections — создать раздел (Б1–Б6)
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/projects/:id/sections",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { project, denied } = await loadProjectWithAccess(request.params.id, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");
      if (!canEditSection(request, project.id, "worklog")) {
        return Errors.forbidden(reply, "Нет прав на редактирование выполняемых работ");
      }

      const parsed = sectionCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return Errors.validation(reply, { message: parsed.error.issues[0].message });
      }
      const data = parsed.data;

      // Валидация Б6 > Б5
      const dateErr = validateDates(data.planStart, data.planFinish);
      if (dateErr) return Errors.validation(reply, { message: dateErr });

      // sortOrder = макс + 1 (Б3, авто)
      const last = await prisma.section.findFirst({
        where: { projectId: project.id },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      const nextOrder = (last?.sortOrder ?? 0) + 1;

      const section = await prisma.section.create({
        data: {
          projectId: project.id,
          name: data.name,
          code: data.code,
          contractorId: data.contractorId,
          planStart: new Date(data.planStart),
          planFinish: new Date(data.planFinish),
          factStart: data.factStart ? new Date(data.factStart) : null,
          factFinish: data.factFinish ? new Date(data.factFinish) : null,
          percentDone: data.percentDone ?? 0,
          sortOrder: nextOrder,
        },
      });

      request.log.info(`✅ Раздел создан: "${section.name}" (проект ${project.name})`);
      reply.code(201);
      return section;
    }
  );

  // PATCH /sections/:id — изменить раздел
  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/sections/:id",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const section = await prisma.section.findUnique({ where: { id: request.params.id } });
      if (!section) return Errors.notFound(reply, "Раздел не найден");

      const { project, denied } = await loadProjectWithAccess(section.projectId, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");
      if (!canEditSection(request, project.id, "worklog")) {
        return Errors.forbidden(reply, "Нет прав на редактирование выполняемых работ");
      }

      const parsed = sectionUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return Errors.validation(reply, { message: parsed.error.issues[0].message });
      }
      const data = parsed.data;

      // Если меняются даты — проверить Б6 > Б5
      const newStart = data.planStart ?? section.planStart.toISOString();
      const newFinish = data.planFinish ?? section.planFinish.toISOString();
      const dateErr = validateDates(newStart, newFinish);
      if (dateErr) return Errors.validation(reply, dateErr);

      const updated = await prisma.section.update({
        where: { id: section.id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.code !== undefined && { code: data.code }),
          ...(data.contractorId !== undefined && { contractorId: data.contractorId }),
          ...(data.planStart !== undefined && { planStart: new Date(data.planStart) }),
          ...(data.planFinish !== undefined && { planFinish: new Date(data.planFinish) }),
          ...(data.factStart !== undefined && {
            factStart: data.factStart ? new Date(data.factStart) : null,
          }),
          ...(data.factFinish !== undefined && {
            factFinish: data.factFinish ? new Date(data.factFinish) : null,
          }),
          ...(data.percentDone !== undefined && { percentDone: data.percentDone }),
        },
      });

      // ПР-4.1 / вопрос 8, вариант «в»: мягкое предупреждение,
      // если факт окончания стоит, а прогресс ещё не 100%
      const warnings: string[] = [];
      if (updated.factFinish) {
        const pct = Number(updated.percentDone);
        if (pct < 100) {
          warnings.push(
            `Указана дата фактического окончания, но выполнение раздела ${pct}% (не 100%).`
          );
        }
      }

      return { ...updated, warnings };
    }
  );

  // DELETE /sections/:id — удалить (только если нет прогресса) ТЗ Б
  app.delete<{ Params: { id: string } }>(
    "/sections/:id",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const section = await prisma.section.findUnique({
        where: { id: request.params.id },
        include: { progress: { select: { id: true } } },
      });
      if (!section) return Errors.notFound(reply, "Раздел не найден");

      const { project, denied } = await loadProjectWithAccess(section.projectId, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");
      if (!canEditSection(request, project.id, "worklog")) {
        return Errors.forbidden(reply, "Нет прав на редактирование выполняемых работ");
      }

      // ТЗ: удалить только если нет данных по нему
      if (section.progress.length > 0) {
        return Errors.conflict(
          reply,
          "Нельзя удалить раздел: по нему уже есть данные прогресса"
        );
      }

      await prisma.section.delete({ where: { id: section.id } });
      request.log.info(`🗑️ Раздел удалён: "${section.name}"`);
      return { success: true };
    }
  );

  // PATCH /projects/:id/sections/reorder — порядок (Б3, drag)
  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/projects/:id/sections/reorder",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { project, denied } = await loadProjectWithAccess(request.params.id, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");
      if (!canEditSection(request, project.id, "worklog")) {
        return Errors.forbidden(reply, "Нет прав на редактирование выполняемых работ");
      }

      const parsed = reorderSchema.safeParse(request.body);
      if (!parsed.success) {
        return Errors.validation(reply, { message: "Ожидается массив order: [id, id, ...]" });
      }

      // Обновляем sortOrder по позиции в массиве (транзакция)
      await prisma.$transaction(
        parsed.data.order.map((sectionId, index) =>
          prisma.section.update({
            where: { id: sectionId },
            data: { sortOrder: index + 1 },
          })
        )
      );

      request.log.info(`↕️ Порядок разделов обновлён (проект ${project.name})`);
      return { success: true };
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // ПОДРЯДЧИКИ (Contractor)
  // ═══════════════════════════════════════════════════════════════

  // GET /projects/:id/contractors — список
  app.get<{ Params: { id: string } }>(
    "/projects/:id/contractors",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { project, denied } = await loadProjectWithAccess(request.params.id, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const contractors = await prisma.contractor.findMany({
        where: { projectId: project.id },
        orderBy: { name: "asc" },
      });
      return contractors;
    }
  );

  // POST /projects/:id/contractors — создать
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/projects/:id/contractors",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { project, denied } = await loadProjectWithAccess(request.params.id, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const parsed = contractorCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return Errors.validation(reply, { message: parsed.error.issues[0].message });
      }

      const contractor = await prisma.contractor.create({
        data: { projectId: project.id, ...parsed.data },
      });
      request.log.info(`✅ Подрядчик создан: "${contractor.name}"`);
      reply.code(201);
      return contractor;
    }
  );

  // PATCH /contractors/:id — изменить
  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/contractors/:id",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const contractor = await prisma.contractor.findUnique({ where: { id: request.params.id } });
      if (!contractor) return Errors.notFound(reply, "Подрядчик не найден");

      const { project, denied } = await loadProjectWithAccess(contractor.projectId, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const parsed = contractorUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return Errors.validation(reply, { message: parsed.error.issues[0].message });
      }

      const updated = await prisma.contractor.update({
        where: { id: contractor.id },
        data: parsed.data,
      });
      return updated;
    }
  );

  // DELETE /contractors/:id — удалить (если не привязан) ТЗ
  app.delete<{ Params: { id: string } }>(
    "/contractors/:id",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const contractor = await prisma.contractor.findUnique({
        where: { id: request.params.id },
        include: {
          sections: { select: { id: true } },
          workLogs: { select: { id: true } },
        },
      });
      if (!contractor) return Errors.notFound(reply, "Подрядчик не найден");

      const { project, denied } = await loadProjectWithAccess(contractor.projectId, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      // ТЗ: удалить только если не привязан (нет разделов и работ)
      if (contractor.sections.length > 0 || contractor.workLogs.length > 0) {
        return Errors.conflict(
          reply,
          "Нельзя удалить подрядчика: он привязан к разделам или работам"
        );
      }

      await prisma.contractor.delete({ where: { id: contractor.id } });
      request.log.info(`🗑️ Подрядчик удалён: "${contractor.name}"`);
      return { success: true };
    }
  );
}
