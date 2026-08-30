import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authGuard } from "../middleware/authGuard.js";
import { Errors } from "../lib/errors.js";
import { getUserRequestAccess } from "../lib/access.js";
import { hashPassword } from "../lib/password.js";
import {
  activationExpiresAt,
  createActivationToken,
  hashActivationToken,
} from "../lib/activation.js";
import { env } from "../config/env.js";
import { loadParticipantDirectory, mapParticipantRole } from "../lib/participant-directory.js";
import { listEmployees } from "../lib/employees.js";

const INVITABLE_ROLES = [
  "pzgd", "head_of_projects", "gip", "gip_deputy", "coordinator", "stroycontrol",
] as const;
const GLOBAL_ROLES = new Set(["pzgd", "head_of_projects"]);

const inviteSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  displayName: z.string().trim().min(2).max(200),
  role: z.enum(INVITABLE_ROLES),
  projectIds: z.array(z.string().uuid()).max(100).default([]),
});

const passwordSchema = z.object({
  password: z.string()
    .min(10, "Пароль должен быть не короче 10 символов")
    .regex(/[a-zA-Zа-яА-Я]/, "Пароль должен содержать хотя бы одну букву")
    .regex(/[0-9]/, "Пароль должен содержать хотя бы одну цифру"),
});

const updateUserSchema = z.object({
  isActive: z.boolean().optional(),
  projectIds: z.array(z.string().uuid()).max(100).optional(),
}).strict().refine((data) => data.isActive !== undefined || data.projectIds !== undefined, {
  message: "Не переданы изменения",
});
const directoryQuerySchema = z.object({ role: z.enum(INVITABLE_ROLES) });

export async function userRoutes(app: FastifyInstance) {
  // ── GET /users — список учётных записей руководителей ──────────
  app.get("/users", { preHandler: authGuard }, async (request, reply) => {
    const access = await getUserRequestAccess(request);
    if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
    if (access.role !== "superadmin") {
      return Errors.forbidden(reply, "Управление пользователями доступно суперадмину");
    }

    const users = await prisma.user.findMany({
      where: { tenantId: access.tenantId },
      orderBy: { createdAt: "desc" },
      include: {
        userProjects: { include: { project: { select: { id: true, name: true } } } },
        activationInvites: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      accessScope: user.accessScope,
      isActive: user.isActive,
      activated: Boolean(user.passwordHash),
      projects: user.userProjects.map((item) => item.project),
      invitation: user.activationInvites[0]
        ? {
            expiresAt: user.activationInvites[0].expiresAt,
            usedAt: user.activationInvites[0].usedAt,
          }
        : null,
    }));
  });

  // ── GET /users/directory — кандидаты из Google-справочника ────
  app.get<{ Querystring: { role?: string } }>(
    "/users/directory",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
      if (access.role !== "superadmin") {
        return Errors.forbidden(reply, "Справочник руководителей доступен суперадмину");
      }
      const parsed = directoryQuerySchema.safeParse(request.query);
      if (!parsed.success) return Errors.validation(reply, parsed.error.flatten());
      try {
        const csvUrl = env.GOOGLE_PARTICIPANTS_CSV_URL?.trim();
        // Правки v6: оба экрана используют один уже подключённый справочник.
        // Отдельный CSV остаётся поддержанным как более строгий вариант.
        const people = csvUrl
          ? await loadParticipantDirectory(csvUrl)
          : (await listEmployees()).flatMap((employee, index) => {
              const role = mapParticipantRole(employee.position ?? "");
              return role ? [{
                id: `${index + 2}:${employee.email}`,
                displayName: employee.fullName,
                email: employee.email,
                role,
              }] : [];
            });
        return {
          configured: Boolean(csvUrl || process.env.EMPLOYEES_SHEET_ID),
          people: people.filter((person) => person.role === parsed.data.role),
        };
      } catch (error) {
        request.log.warn({ error }, "Не удалось обновить Google-справочник");
        return {
          configured: true,
          people: [],
          warning: error instanceof Error ? error.message : "Не удалось прочитать справочник",
        };
      }
    },
  );

  // ── POST /users/invitations — создать или перевыпустить ссылку ─
  app.post("/users/invitations", { preHandler: authGuard }, async (request, reply) => {
    const access = await getUserRequestAccess(request);
    if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
    if (access.role !== "superadmin") {
      return Errors.forbidden(reply, "Приглашать руководителей может только суперадмин");
    }
    const parsed = inviteSchema.safeParse(request.body);
    if (!parsed.success) return Errors.validation(reply, parsed.error.flatten());
    const data = parsed.data;
    const accessScope = GLOBAL_ROLES.has(data.role) ? "global" : "project";
    if (accessScope === "project" && data.projectIds.length === 0) {
      return Errors.validation(reply, { projectIds: ["Выберите хотя бы один проект"] });
    }

    const projects = await prisma.project.findMany({
      where: {
        id: { in: data.projectIds }, tenantId: access.tenantId, deletedAt: null,
      },
      select: { id: true },
    });
    if (projects.length !== data.projectIds.length) {
      return Errors.validation(reply, { projectIds: ["Один из проектов недоступен"] });
    }

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing?.passwordHash) {
      return Errors.conflict(reply, "Пользователь с таким email уже активирован");
    }
    if (existing && existing.tenantId !== access.tenantId) {
      return Errors.conflict(reply, "Этот email уже используется другой организацией");
    }

    const { token, tokenHash } = createActivationToken();
    const expiresAt = activationExpiresAt();
    const user = await prisma.$transaction(async (tx) => {
      const saved = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              displayName: data.displayName, role: data.role,
              accessScope, isActive: true,
            },
          })
        : await tx.user.create({
            data: {
              tenantId: access.tenantId,
              email: data.email,
              displayName: data.displayName,
              passwordHash: "",
              role: data.role,
              accessScope,
              isActive: true,
              mustChangePassword: false,
            },
          });
      await tx.userProject.deleteMany({ where: { userId: saved.id } });
      if (accessScope === "project") {
        await tx.userProject.createMany({
          data: data.projectIds.map((projectId) => ({ userId: saved.id, projectId })),
        });
      }
      await tx.activationInvite.updateMany({
        where: { userId: saved.id, usedAt: null }, data: { usedAt: new Date() },
      });
      await tx.activationInvite.create({
        data: { userId: saved.id, tokenHash, expiresAt, createdBy: access.id },
      });
      return saved;
    });

    reply.code(201);
    return {
      user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
      activationPath: `/activate/${token}`,
      expiresAt,
    };
  });

  // ── PATCH /users/:id — деактивировать или вернуть руководителя ─
  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/users/:id",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
      if (access.role !== "superadmin") {
        return Errors.forbidden(reply, "Управление пользователями доступно суперадмину");
      }
      const parsed = updateUserSchema.safeParse(request.body);
      if (!parsed.success) return Errors.validation(reply, parsed.error.flatten());
      if (request.params.id === access.id && parsed.data.isActive === false) {
        return Errors.conflict(reply, "Нельзя деактивировать собственную учётную запись");
      }
      const user = await prisma.user.findFirst({
        where: { id: request.params.id, tenantId: access.tenantId },
      });
      if (!user) return Errors.notFound(reply, "Пользователь не найден");

      if (parsed.data.projectIds !== undefined) {
        if (user.accessScope === "global") {
          return Errors.conflict(reply, "Для глобальной роли доступны все проекты");
        }
        if (parsed.data.projectIds.length === 0) {
          return Errors.validation(reply, { projectIds: ["Выберите хотя бы один проект"] });
        }
        const projects = await prisma.project.findMany({
          where: { id: { in: parsed.data.projectIds }, tenantId: access.tenantId, deletedAt: null },
          select: { id: true },
        });
        if (projects.length !== parsed.data.projectIds.length) {
          return Errors.validation(reply, { projectIds: ["Один из проектов недоступен"] });
        }
      }

      const updated = await prisma.$transaction(async (tx) => {
        const saved = parsed.data.isActive === undefined
          ? user
          : await tx.user.update({
              where: { id: user.id }, data: { isActive: parsed.data.isActive },
            });
        if (parsed.data.projectIds !== undefined) {
          await tx.userProject.deleteMany({ where: { userId: user.id } });
          await tx.userProject.createMany({
            data: parsed.data.projectIds.map((projectId) => ({ userId: user.id, projectId })),
          });
        }
        return saved;
      });
      request.log.info(`👤 Учётная запись обновлена: ${updated.email}`);
      return { id: updated.id, isActive: updated.isActive };
    },
  );

  // ── DELETE /users/:id — удалить только после деактивации ────────
  app.delete<{ Params: { id: string } }>(
    "/users/:id",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
      if (access.role !== "superadmin") {
        return Errors.forbidden(reply, "Управление пользователями доступно суперадмину");
      }
      if (request.params.id === access.id) {
        return Errors.conflict(reply, "Нельзя удалить собственную учётную запись");
      }
      const user = await prisma.user.findFirst({
        where: { id: request.params.id, tenantId: access.tenantId },
      });
      if (!user) return Errors.notFound(reply, "Пользователь не найден");
      if (user.isActive) {
        return Errors.conflict(reply, "Сначала деактивируйте пользователя");
      }

      await prisma.user.delete({ where: { id: user.id } });
      request.log.info(`🗑️ Учётная запись руководителя удалена: ${user.email}`);
      reply.code(204).send();
    },
  );

  // ── GET /auth/activate/:token — проверка ссылки без раскрытия хеша ─
  app.get<{ Params: { token: string } }>("/auth/activate/:token", async (request, reply) => {
    const invite = await prisma.activationInvite.findUnique({
      where: { tokenHash: hashActivationToken(request.params.token) },
      include: { user: { select: { email: true, displayName: true, isActive: true } } },
    });
    if (!invite || invite.usedAt || invite.expiresAt <= new Date() || !invite.user.isActive) {
      return Errors.notFound(reply, "Ссылка активации недействительна или истекла");
    }
    return { email: invite.user.email, displayName: invite.user.displayName, expiresAt: invite.expiresAt };
  });

  // ── POST /auth/activate/:token — руководитель сам задаёт пароль ─
  app.post<{ Params: { token: string } }>("/auth/activate/:token", async (request, reply) => {
    const parsed = passwordSchema.safeParse(request.body);
    if (!parsed.success) return Errors.validation(reply, parsed.error.flatten());
    const invite = await prisma.activationInvite.findUnique({
      where: { tokenHash: hashActivationToken(request.params.token) },
      include: { user: true },
    });
    if (!invite || invite.usedAt || invite.expiresAt <= new Date() || !invite.user.isActive) {
      return Errors.notFound(reply, "Ссылка активации недействительна или истекла");
    }
    const passwordHash = await hashPassword(parsed.data.password);
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.activationInvite.updateMany({
        where: { id: invite.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error("Ссылка активации уже использована");
      await tx.user.update({
        where: { id: invite.userId },
        data: { passwordHash, mustChangePassword: false },
      });
    });
    return { success: true, email: invite.user.email };
  });
}
