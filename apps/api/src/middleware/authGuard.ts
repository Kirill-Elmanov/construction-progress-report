import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyToken } from "../lib/jwt.js";
import { Errors } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { getEmployee } from "./../lib/employees.js";

/**
 * authGuard — двойная авторизация [ПР-1.5]:
 *   1) Authorization: Bearer <JWT>        — вход по логину/паролю
 *   2) X-Access-Token: <token>            — вход специалиста по ссылке
 *      (или ?accessToken=... в query — удобно для первого перехода)
 *
 * Всегда заполняет request.actor (для аудита), а для JWT — ещё и request.user.
 */
export async function authGuard(request: FastifyRequest, reply: FastifyReply) {
  // ── Ветка 1: JWT (пользователь с паролем) ──────────────────────
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7);
    try {
      const payload = verifyToken(token);
      request.user = {
        userId: payload.userId,
        role: payload.role as any,
        tenantId: payload.tenantId,
      };

      const dbUser = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { email: true, displayName: true },
      });
      const fullName = dbUser
        ? (await getEmployee(dbUser.email))?.fullName ?? dbUser.displayName
        : "Неизвестный пользователь";

      request.actor = {
        kind: "user",
        id: payload.userId,
        name: fullName,
        email: dbUser?.email ?? null,
        role: payload.role,
        tenantId: payload.tenantId,
      };
      return;
    } catch {
      return Errors.unauthorized(reply, "Невалидный или просроченный токен");
    }
  }

  // ── Ветка 2: ссылка-доступ (специалист без пароля) ─────────────
  const linkToken =
    (request.headers["x-access-token"] as string | undefined) ??
    (request.query as { accessToken?: string } | undefined)?.accessToken;

  if (linkToken) {
    const link = await prisma.accessLink.findUnique({ where: { token: linkToken } });

    if (!link || !link.isActive) {
      return Errors.unauthorized(reply, "Ссылка-доступ недействительна или отозвана");
    }
    // Правки v6: один персональный токен сохраняется, но проекты и секции
    // можно включать и выключать без перевыпуска ссылки.
    const grants = await prisma.accessGrant.findMany({
      where: { linkId: link.id, isActive: true, project: { deletedAt: null } },
      include: { project: { select: { id: true, name: true } } },
    });

    // ПР-1.5: личность специалиста из Google-справочника по email
    const emp = link.email ? await getEmployee(link.email) : null;
    const name = emp?.fullName ?? link.displayName ?? "Специалист по ссылке";

    request.actor = {
      kind: "link",
      id: link.id,
      name,
      email: link.email,
      role: link.role,
      tenantId: link.tenantId,
      grants: grants.map((grant) => ({
        projectId: grant.project.id,
        projectName: grant.project.name,
        allowedSections: grant.allowedSections,
      })),
    };

    // отметка последнего использования (не блокируем ответ)
    prisma.accessLink
      .update({ where: { id: link.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});

    return;
  }

  return Errors.unauthorized(reply, "Отсутствует токен авторизации");
}
