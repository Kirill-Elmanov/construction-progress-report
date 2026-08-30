import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { authGuard } from "../middleware/authGuard.js";
import { Errors } from "../lib/errors.js";
import { getUserRequestAccess, loadProjectWithAccess } from "../lib/access.js";
import { listEmployees, getEmployee } from "../lib/employees.js";
import { SECTION_KEYS } from "@rost/shared/types";

/**
 * Персональные ссылки-доступы [Этап 2].
 * Правки v6: один сотрудник сохраняет один персональный токен,
 * а руководитель может менять список его проектов и доступных секций.
 */

const MANAGE_ROLES = [
  "superadmin", "pzgd", "head_of_projects", "gip", "gip_deputy", "coordinator",
];

const createSchema = z.object({
  email: z.string().email("Некорректный email").optional().nullable(),
  displayName: z.string().max(150).optional().nullable(),
  role: z.enum([
    "pzgd", "head_of_projects", "gip", "gip_deputy",
    "coordinator", "stroycontrol", "ksp", "viewer",
  ]),
  allowedSections: z.array(z.enum(SECTION_KEYS)).max(20),
  projectIds: z.array(z.string().uuid()).min(1).max(100),
}).superRefine((data, ctx) => {
  if (data.role !== "viewer" && data.allowedSections.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["allowedSections"],
      message: "Выберите хотя бы одну секцию",
    });
  }
});

const updateSchema = z.object({
  allowedSections: z.array(z.enum(SECTION_KEYS)).min(1).max(20).optional(),
  projectIds: z.array(z.string().uuid()).min(1).max(100).optional(),
  isActive: z.boolean().optional(),
}).strict();

export async function accessLinkRoutes(app: FastifyInstance) {
  // ── GET /employees — справочник для выпадашки ────────────────────
  app.get("/employees", { preHandler: authGuard }, async (request, reply) => {
    const access = await getUserRequestAccess(request);
    if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
    if (!MANAGE_ROLES.includes(access.role)) {
      return Errors.forbidden(reply, "Недостаточно прав");
    }
    return listEmployees();
  });

  // ── GET /access-links — единый список токенов организации ───────
  app.get("/access-links", { preHandler: authGuard }, async (request, reply) => {
    const access = await getUserRequestAccess(request);
    if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
    if (!MANAGE_ROLES.includes(access.role)) {
      return Errors.forbidden(reply, "Недостаточно прав для управления доступами");
    }

    const links = await prisma.accessLink.findMany({
      where: { tenantId: access.tenantId },
      orderBy: { createdAt: "desc" },
      include: {
        grants: {
          where: { isActive: true, project: { deletedAt: null } },
          include: { project: { select: { id: true, name: true } } },
        },
      },
    });

    return Promise.all(links.map(async (link) => ({
      id: link.id,
      personalLinkId: link.id,
      token: link.token,
      role: link.role,
      allowedSections: link.allowedSections,
      projects: link.grants.map((grant) => grant.project),
      email: link.email,
      fullName: link.email
        ? (await getEmployee(link.email))?.fullName ?? link.displayName
        : link.displayName,
      isActive: link.isActive,
      lastUsedAt: link.lastUsedAt,
      createdAt: link.createdAt,
    })));
  });

  // ── POST /access-links — токен сразу для всех проектов ──────────
  app.post<{ Body: unknown }>(
    "/access-links",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
      if (!MANAGE_ROLES.includes(access.role)) {
        return Errors.forbidden(reply, "Создавать доступы может только руководитель");
      }

      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return Errors.validation(reply, parsed.error.flatten().fieldErrors);
      }
      const d = parsed.data;
      if (!d.email && !d.displayName) {
        return Errors.validation(reply, {
          email: ["Укажите сотрудника из справочника или введите имя вручную"],
        });
      }

      const projects = await prisma.project.findMany({
        where: { id: { in: d.projectIds }, tenantId: access.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (projects.length !== d.projectIds.length) {
        return Errors.validation(reply, { projectIds: ["Один из проектов недоступен"] });
      }

      const normalizedEmail = d.email?.trim().toLowerCase() ?? null;
      const existing = normalizedEmail
        ? await prisma.accessLink.findUnique({
            where: { tenantId_email: { tenantId: access.tenantId, email: normalizedEmail } },
          })
        : null;

      const link = await prisma.$transaction(async (tx) => {
        const saved = existing
          ? await tx.accessLink.update({
              where: { id: existing.id },
              data: {
                role: d.role as any,
                allowedSections: d.allowedSections,
                displayName: d.displayName ?? existing.displayName,
                isActive: true,
              },
            })
          : await tx.accessLink.create({
              data: {
                tenantId: access.tenantId,
                token: randomBytes(32).toString("hex"),
                role: d.role as any,
                allowedSections: d.allowedSections,
                email: normalizedEmail,
                displayName: d.displayName ?? null,
                createdBy: request.actor?.kind === "user" ? request.actor.id : null,
              },
            });
        await tx.accessGrant.deleteMany({ where: { linkId: saved.id } });
        await tx.accessGrant.createMany({
          data: d.projectIds.map((projectId) => ({
            linkId: saved.id, projectId, allowedSections: d.allowedSections,
          })),
        });
        return saved;
      });

      request.log.info(
        `🔗 Общий токен создан: ${d.email ?? d.displayName} ` +
          `[${d.allowedSections.join(", ")}]${existing ? " · прежний токен сохранён" : ""}`
      );
      reply.code(201);
      return {
        id: link.id,
        personalLinkId: link.id,
        token: link.token,
        role: link.role,
        allowedSections: link.allowedSections,
        projects: d.projectIds.map((id) => ({ id })),
        email: link.email,
        fullName: d.email ? (await getEmployee(d.email))?.fullName ?? d.displayName : d.displayName,
        isActive: link.isActive,
        lastUsedAt: link.lastUsedAt,
        createdAt: link.createdAt,
        reused: Boolean(existing),
      };
    }
  );

  // ── GET /projects/:id/access-links ───────────────────────────────
  app.get<{ Params: { id: string } }>(
    "/projects/:id/access-links",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
      if (!MANAGE_ROLES.includes(access.role)) {
        return Errors.forbidden(reply, "Недостаточно прав для управления доступами");
      }

      const { project, denied } = await loadProjectWithAccess(request.params.id, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const grants = await prisma.accessGrant.findMany({
        where: { projectId: project.id },
        include: { link: true },
        orderBy: { createdAt: "desc" },
      });

      // Подтягиваем актуальные ФИО из справочника
      return Promise.all(
        grants.map(async (grant) => ({
          id: grant.link.id, // общий токен изменяется целиком
          personalLinkId: grant.link.id,
          token: grant.link.token,
          role: grant.link.role,
          allowedSections: grant.link.allowedSections,
          email: grant.link.email,
          fullName: grant.link.email
            ? (await getEmployee(grant.link.email))?.fullName ?? grant.link.displayName
            : grant.link.displayName,
          isActive: grant.link.isActive,
          lastUsedAt: grant.link.lastUsedAt,
          createdAt: grant.createdAt,
        }))
      );
    }
  );

  // ── POST /projects/:id/access-links — создать ────────────────────
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/projects/:id/access-links",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
      if (!MANAGE_ROLES.includes(access.role)) {
        return Errors.forbidden(reply, "Создавать доступы может только руководитель");
      }

      const { project, denied } = await loadProjectWithAccess(request.params.id, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const parsed = createSchema.safeParse({
        ...(request.body && typeof request.body === "object" ? request.body : {}),
        projectIds: [project.id],
      });
      if (!parsed.success) {
        return Errors.validation(reply, parsed.error.flatten().fieldErrors);
      }
      const d = parsed.data;

      if (!d.email && !d.displayName) {
        return Errors.validation(reply, {
          email: ["Укажите сотрудника из справочника или введите имя вручную"],
        });
      }

      const normalizedEmail = d.email?.trim().toLowerCase() ?? null;

      // Для сотрудника из справочника повторно используем персональный токен.
      // Новое назначение добавляет проект, не создавая ещё одну ссылку.
      const { link, grant, reused } = await prisma.$transaction(async (tx) => {
        const existing = normalizedEmail
          ? await tx.accessLink.findUnique({
              where: {
                tenantId_email: { tenantId: project.tenantId, email: normalizedEmail },
              },
            })
          : null;

        const personalLink = existing
          ? await tx.accessLink.update({
              where: { id: existing.id },
              data: {
                role: d.role as any,
                allowedSections: d.allowedSections,
                displayName: d.displayName ?? existing.displayName,
                isActive: true,
              },
            })
          : await tx.accessLink.create({
              data: {
                tenantId: project.tenantId,
                token: randomBytes(32).toString("hex"), // 64 символа
                role: d.role as any,
                allowedSections: d.allowedSections,
                email: normalizedEmail,
                displayName: d.displayName ?? null,
                createdBy: request.actor?.kind === "user" ? request.actor.id : null,
              },
            });

        const projectGrant = await tx.accessGrant.upsert({
          where: {
            linkId_projectId: { linkId: personalLink.id, projectId: project.id },
          },
          update: { allowedSections: d.allowedSections, isActive: true },
          create: {
            linkId: personalLink.id,
            projectId: project.id,
            allowedSections: d.allowedSections,
          },
        });

        return { link: personalLink, grant: projectGrant, reused: Boolean(existing) };
      });

      request.log.info(
        `🔗 Назначение создано: ${d.email ?? d.displayName} → ${project.name} ` +
          `[${d.allowedSections.join(", ")}]${reused ? " · персональный токен сохранён" : ""}`
      );
      reply.code(201);
      return {
        id: link.id,
        personalLinkId: link.id,
        token: link.token,
        role: link.role,
        allowedSections: link.allowedSections,
        email: link.email,
        isActive: link.isActive,
        lastUsedAt: link.lastUsedAt,
        createdAt: grant.createdAt,
        reused,
        fullName: d.email ? (await getEmployee(d.email))?.fullName ?? d.displayName : d.displayName,
      };
    }
  );

  // ── PATCH /access-links/:id — изменить общий токен ──────────────
  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/access-links/:id",
    { preHandler: authGuard },
    async (
      request,
      reply
    ) => {
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
      if (!MANAGE_ROLES.includes(access.role)) {
        return Errors.forbidden(reply, "Недостаточно прав");
      }

      const link = await prisma.accessLink.findFirst({
        where: { id: request.params.id, tenantId: access.tenantId },
      });
      if (!link) return Errors.notFound(reply, "Токен не найден");

      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) {
        return Errors.validation(reply, parsed.error.flatten().fieldErrors);
      }

      if (parsed.data.projectIds !== undefined) {
        const projects = await prisma.project.findMany({
          where: { id: { in: parsed.data.projectIds }, tenantId: access.tenantId, deletedAt: null },
          select: { id: true },
        });
        if (projects.length !== parsed.data.projectIds.length) {
          return Errors.validation(reply, { projectIds: ["Один из проектов недоступен"] });
        }
      }

      const updated = await prisma.$transaction(async (tx) => {
        const saved = await tx.accessLink.update({
          where: { id: link.id },
          data: {
            ...(parsed.data.allowedSections !== undefined && {
              allowedSections: parsed.data.allowedSections,
            }),
            ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
          },
        });
        const allowedSections = parsed.data.allowedSections ?? link.allowedSections;
        if (parsed.data.projectIds !== undefined) {
          await tx.accessGrant.deleteMany({ where: { linkId: link.id } });
          await tx.accessGrant.createMany({
            data: parsed.data.projectIds.map((projectId) => ({
              linkId: link.id, projectId, allowedSections,
            })),
          });
        } else if (parsed.data.allowedSections !== undefined) {
          await tx.accessGrant.updateMany({
            where: { linkId: link.id }, data: { allowedSections },
          });
        }
        return saved;
      });

      request.log.info(`🔗 Общий токен обновлён: ${updated.id} (активно: ${updated.isActive})`);
      return updated;
    }
  );

  // ── DELETE /access-links/:id — удалить больше не нужный доступ ──
  app.delete<{ Params: { id: string } }>(
    "/access-links/:id",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
      if (!MANAGE_ROLES.includes(access.role)) {
        return Errors.forbidden(reply, "Недостаточно прав");
      }

      const link = await prisma.accessLink.findFirst({
        where: { id: request.params.id, tenantId: access.tenantId },
      });
      if (!link) return Errors.notFound(reply, "Токен не найден");

      // Проектные назначения удалятся каскадно, история аудита сохранит ФИО.
      await prisma.accessLink.delete({ where: { id: link.id } });
      request.log.info(`🗑️ Доступ специалиста удалён: ${link.email ?? link.displayName ?? link.id}`);
      reply.code(204).send();
    },
  );

  // ── GET /access-links/whoami — кто я по ссылке (для фронта) ───────
  app.get("/access-links/whoami", { preHandler: authGuard }, async (request, reply) => {
    const actor = request.actor;
    if (!actor) return Errors.unauthorized(reply, "Не авторизован");
    const projects = actor.grants ?? [];
    const onlyProject = projects.length === 1 ? projects[0] : null;
    return {
      kind: actor.kind,
      name: actor.name,
      email: actor.email,
      role: actor.role,
      projects,
      // Поля совместимости удалим после перевода всего интерфейса.
      projectId: onlyProject?.projectId ?? null,
      allowedSections: onlyProject?.allowedSections ?? null,
    };
  });
}
