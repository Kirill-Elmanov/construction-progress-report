import type { FastifyRequest, FastifyReply } from "fastify";
import type { RoleType } from "@prisma/client";
import { Errors } from "../lib/errors.js";

/**
 * RBAC (ТЗ 4.6) — проверка ролей.
 * Используется ПОСЛЕ authGuard (request.user уже должен быть заполнен).
 */

// Разрешить доступ только указанным ролям
export function requireRole(...roles: RoleType[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return Errors.unauthorized(reply);
    }
    if (!roles.includes(request.user.role)) {
      return Errors.forbidden(reply);
    }
  };
}

// Только суперадмин
export const requireSuperadmin = requireRole("superadmin");

// Только global-админы (ПЗГД / Руководитель проектов) — ТЗ раздел 2
export const requireGlobalAdmin = requireRole(
  "superadmin",
  "pzgd",
  "head_of_projects"
);