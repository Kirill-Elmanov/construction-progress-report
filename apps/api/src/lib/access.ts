import { prisma } from "./prisma.js";
import { normalizeSectionKey, type SectionKey } from "@rost/shared/types";

/**
 * Общие хелперы контроля доступа (RBAC + мультиарендность).
 * Используются во всех роутах данных: sections, progress, issues, budget…
 *
 * Логика (ТЗ 4.3, 4.6):
 *   • global-админ (superadmin/pzgd/gip…) видит все проекты своего тенанта.
 *   • project-админ (coordinator…) — только назначенные (user_projects).
 *   • Всегда проверяем принадлежность к tenantId (изоляция арендаторов).
 */

// Тип результата getAccess (для типизации в роутах)
export interface AccessContext {
  id: string;
  tenantId: string;
  accessScope: "global" | "project";
  role: string;
  isActive: boolean;
  projectIds: string[];
}

/** Загружает пользователя + список его проектов (для project-scope). */
export async function getAccess(userId: string): Promise<AccessContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, tenantId: true, accessScope: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) return null;

  let projectIds: string[] = [];
  if (user.accessScope === "project") {
    const links = await prisma.userProject.findMany({
      where: { userId: user.id },
      select: { projectId: true },
    });
    projectIds = links.map((l) => l.projectId);
  }
  return { ...user, projectIds } as AccessContext;
}

/** Проверяет доступ к конкретному проекту (global → всегда, project → по списку). */
export function canAccessProject(
  access: { accessScope: string; projectIds: string[] },
  projectId: string
): boolean {
  if (access.accessScope === "global") return true;
  return access.projectIds.includes(projectId);
}

/** Загружает проект + проверяет доступ. { project, denied }. */
export async function loadProjectWithAccess(projectId: string, access: AccessContext) {
  // Проект в корзине недоступен через обычные API, но все его данные сохранены.
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
  });
  if (!project || project.tenantId !== access.tenantId) {
    return { project: null, denied: false };
  }
  if (!canAccessProject(access, project.id)) {
    return { project, denied: true };
  }
  return { project, denied: false };
}

/** Загружает отчёт (+ его проект) + проверяет доступ. { report, denied }. */
export async function loadReportWithAccess(reportId: string, access: AccessContext) {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      project: { select: { id: true, tenantId: true, name: true, deletedAt: true } },
    },
  });
  if (!report || report.project.tenantId !== access.tenantId || report.project.deletedAt) {
    return { report: null, denied: false };
  }
  if (!canAccessProject(access, report.project.id)) {
    return { report, denied: true };
  }
  return { report, denied: false };
}

import type { FastifyRequest } from "fastify";

/**
 * ПР-1.5: единая точка получения контекста доступа.
 * Работает и для пользователя с паролем, и для специалиста по ссылке.
 */
export async function getRequestAccess(
  request: FastifyRequest
): Promise<AccessContext | null> {
  const actor = request.actor;
  if (!actor) return null;

  // Вход по паролю — старая логика
  if (actor.kind === "user") {
    return getAccess(actor.id);
  }

  // Вход по ссылке — доступ только к своему проекту
  return {
    id: actor.id,
    tenantId: actor.tenantId,
    accessScope: "project",
    role: actor.role,
    isActive: true,
    projectIds: actor.grants?.map((grant) => grant.projectId) ?? [],
  };
}

/**
 * Контекст только для сотрудника, вошедшего по логину и паролю.
 * Нужен в управляющих операциях: ссылка с ролью «ГИП» не должна получать
 * права создавать проекты, удалять отчёты или выдавать новые ссылки.
 */
export async function getUserRequestAccess(
  request: FastifyRequest
): Promise<AccessContext | null> {
  if (request.actor?.kind !== "user") return null;
  return getAccess(request.actor.id);
}

/** ПР-1.5: может ли актор РЕДАКТИРОВАТЬ данную секцию. */
export function canEditSection(
  request: FastifyRequest,
  projectId: string,
  sectionKey: SectionKey
): boolean {
  const actor = request.actor;
  if (!actor) return false;
  // Пользователи с паролем редактируют всё
  if (actor.kind === "user") return true;
  // Роль «Наблюдатель» всегда только читает, даже при ошибочно выбранной секции.
  if (actor.role === "viewer") return false;
  // Специалист — только секции назначения именно этого проекта.
  const grant = actor.grants?.find((item) => item.projectId === projectId);
  return (grant?.allowedSections ?? []).some(
    (savedKey) => normalizeSectionKey(savedKey) === sectionKey
  );
}

/** Может ли актор финализировать отчёт (только вход по паролю). */
export function canFinalizeReport(request: FastifyRequest): boolean {
  return request.actor?.kind === "user";
}
