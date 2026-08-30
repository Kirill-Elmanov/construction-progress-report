import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authGuard } from "../middleware/authGuard.js";
import { Errors } from "../lib/errors.js";
import {
  getRequestAccess,
  getUserRequestAccess,
  loadProjectWithAccess,
} from "../lib/access.js";
import {
  LOCAL_SECTION_KEYS,
  toWorkspaceDto,
} from "../lib/section-workspaces.js";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  sectionKey: z.enum([
    "budget",
    "rd",
    "worklog",
    "prescriptions",
    "resources",
    "issues",
    "photos",
  ]),
});

const correctionSchema = z.object({
  revisionId: z.string().uuid().optional(),
});

export async function sectionWorkspaceRoutes(app: FastifyInstance) {
  // ── GET /projects/:projectId/section-workspaces ─────────────────
  // Сводка нужна экрану подготовки отчёта: видно, что уже зафиксировано,
  // а где после последней фиксации появились новые изменения.
  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/section-workspaces",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { project, denied } = await loadProjectWithAccess(request.params.projectId, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const rows = await prisma.sectionWorkspace.findMany({
        where: {
          projectId: project.id,
          sectionKey: { in: LOCAL_SECTION_KEYS },
        },
        include: { currentRevision: true },
      });
      const byKey = new Map(rows.map((row) => [row.sectionKey, row]));

      return LOCAL_SECTION_KEYS.map((sectionKey) => {
        const row = byKey.get(sectionKey);
        return row
          ? toWorkspaceDto(row)
          : { sectionKey, freshness: "missing", currentRevision: null };
      });
    }
  );

  // ── GET /projects/:projectId/section-workspaces/:sectionKey ────
  app.get<{ Params: { projectId: string; sectionKey: string } }>(
    "/projects/:projectId/section-workspaces/:sectionKey",
    { preHandler: authGuard },
    async (request, reply) => {
      const parsed = paramsSchema.safeParse(request.params);
      if (!parsed.success) return Errors.validation(reply, parsed.error.flatten());
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { project, denied } = await loadProjectWithAccess(parsed.data.projectId, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const row = await prisma.sectionWorkspace.findUnique({
        where: {
          projectId_sectionKey: {
            projectId: project.id,
            sectionKey: parsed.data.sectionKey,
          },
        },
        include: {
          currentRevision: true,
          revisions: { orderBy: { version: "desc" } },
          events: { orderBy: { createdAt: "desc" }, take: 50 },
        },
      });
      if (!row) return Errors.notFound(reply, "Черновик раздела ещё не создан");

      return {
        ...toWorkspaceDto(row),
        draftPayload: row.draftPayload,
        revisions: row.revisions.map((revision) => ({
          id: revision.id,
          version: revision.version,
          fixedAt: revision.fixedAt,
          fixedBy: revision.actorName,
          correctionOfId: revision.correctionOfId,
        })),
        events: row.events,
      };
    }
  );

  // ── POST .../:sectionKey/fix ───────────────────────────────────
  // Фиксация доступна только руководителю с паролем. Токен сотрудника
  // предназначен для заполнения и никогда не выпускает официальную версию.
  app.post<{ Params: { projectId: string; sectionKey: string } }>(
    "/projects/:projectId/section-workspaces/:sectionKey/fix",
    { preHandler: authGuard },
    async (request, reply) => {
      const parsed = paramsSchema.safeParse(request.params);
      if (!parsed.success) return Errors.validation(reply, parsed.error.flatten());
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.forbidden(reply, "Фиксировать версии может только руководитель");

      const { project, denied } = await loadProjectWithAccess(parsed.data.projectId, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const actor = request.actor!;
      const result = await prisma.$transaction(async (tx) => {
        const workspace = await tx.sectionWorkspace.findUnique({
          where: {
            projectId_sectionKey: {
              projectId: project.id,
              sectionKey: parsed.data.sectionKey,
            },
          },
          include: { currentRevision: true },
        });
        if (!workspace?.draftPayload) return null;
        if (workspace.currentRevision?.sourceDraftSequence === workspace.draftSequence) {
          return { unchanged: true as const, workspace };
        }

        const latest = await tx.sectionRevision.findFirst({
          where: { workspaceId: workspace.id },
          orderBy: { version: "desc" },
          select: { version: true },
        });
        const revision = await tx.sectionRevision.create({
          data: {
            workspaceId: workspace.id,
            version: (latest?.version ?? 0) + 1,
            payload: workspace.draftPayload,
            sourceDraftSequence: workspace.draftSequence,
            correctionOfId: workspace.basedOnRevisionId,
            actorKind: actor.kind,
            actorId: actor.id,
            actorName: actor.name,
            actorEmail: actor.email,
            actorRole: actor.role,
          },
        });
        const updated = await tx.sectionWorkspace.update({
          where: { id: workspace.id },
          data: { currentRevisionId: revision.id, basedOnRevisionId: null },
          include: { currentRevision: true },
        });
        await tx.sectionWorkspaceEvent.create({
          data: {
            workspaceId: workspace.id,
            action: "fix",
            actorKind: actor.kind,
            actorId: actor.id,
            actorName: actor.name,
            actorEmail: actor.email,
            actorRole: actor.role,
            summary: `Зафиксирована версия ${revision.version}`,
          },
        });
        return { unchanged: false as const, workspace: updated, revision };
      });

      if (!result) return Errors.conflict(reply, "Сначала сохраните данные раздела");
      if (result.unchanged) {
        return Errors.conflict(reply, "После последней фиксации изменений нет");
      }
      return { data: toWorkspaceDto(result.workspace) };
    }
  );

  // ── POST .../:sectionKey/correct ───────────────────────────────
  // Корректировка копирует выбранную неизменяемую версию в новый черновик.
  // После правок следующая фиксация автоматически получит номер N + 1.
  app.post<{ Params: { projectId: string; sectionKey: string }; Body: unknown }>(
    "/projects/:projectId/section-workspaces/:sectionKey/correct",
    { preHandler: authGuard },
    async (request, reply) => {
      const parsed = paramsSchema.safeParse(request.params);
      if (!parsed.success) return Errors.validation(reply, parsed.error.flatten());
      const body = correctionSchema.safeParse(request.body ?? {});
      if (!body.success) return Errors.validation(reply, body.error.flatten());
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.forbidden(reply, "Создать корректировку может только руководитель");

      const { project, denied } = await loadProjectWithAccess(parsed.data.projectId, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const actor = request.actor!;
      const result = await prisma.$transaction(async (tx) => {
        const workspace = await tx.sectionWorkspace.findUnique({
          where: {
            projectId_sectionKey: {
              projectId: project.id,
              sectionKey: parsed.data.sectionKey,
            },
          },
        });
        if (!workspace) return null;

        const revisionId = body.data.revisionId ?? workspace.currentRevisionId;
        if (!revisionId) return null;

        const revision = await tx.sectionRevision.findFirst({
          where: {
            id: revisionId,
            workspaceId: workspace.id,
          },
        });
        if (!revision) return null;

        const updated = await tx.sectionWorkspace.update({
          where: { id: workspace.id },
          data: {
            draftPayload: revision.payload as Prisma.InputJsonValue,
            draftSequence: { increment: 1 },
            draftUpdatedAt: new Date(),
            draftActorKind: actor.kind,
            draftActorId: actor.id,
            draftActorName: actor.name,
            draftActorEmail: actor.email,
            draftActorRole: actor.role,
            basedOnRevisionId: revision.id,
          },
          include: { currentRevision: true },
        });
        await tx.sectionWorkspaceEvent.create({
          data: {
            workspaceId: workspace.id,
            action: "correct",
            actorKind: actor.kind,
            actorId: actor.id,
            actorName: actor.name,
            actorEmail: actor.email,
            actorRole: actor.role,
            summary: `Создана корректировка версии ${revision.version}`,
          },
        });
        return updated as Prisma.SectionWorkspaceGetPayload<{
          include: { currentRevision: true };
        }>;
      });

      if (!result) return Errors.notFound(reply, "Зафиксированная версия не найдена");
      return { data: toWorkspaceDto(result) };
    }
  );
}
