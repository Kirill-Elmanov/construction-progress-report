import type { FastifyRequest } from "fastify";
import { Prisma, type SectionRevision, type SectionWorkspace } from "@prisma/client";
import {
  SECTION_DEFINITIONS,
  type DataFreshness,
  type SectionKey,
} from "@rost/shared/types";
import { prisma } from "./prisma.js";

// В отдельные локальные версии входят разделы, которые раньше жили только
// внутри недельного отчёта. Объект и график уже являются данными проекта.
export const LOCAL_SECTION_KEYS = SECTION_DEFINITIONS
  .filter((section) => section.source === "report")
  .map((section) => section.key);

function actorData(request: FastifyRequest) {
  const actor = request.actor;
  if (!actor) throw new Error("Актор запроса не определён");
  return {
    actorKind: actor.kind,
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    actorRole: actor.role,
  };
}

function jsonObject(value: Prisma.JsonValue | null): Prisma.JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Prisma.JsonObject;
  }
  return {};
}

/**
 * Сохраняет часть локального черновика. Раздел Г состоит из двух форм
 * (прогресс и перечень работ), поэтому фрагменты объединяются, а не затираются.
 */
export async function mergeSectionDraft(
  request: FastifyRequest,
  projectId: string,
  sectionKey: SectionKey,
  fragment: Prisma.InputJsonObject,
  summary: string
) {
  const actor = actorData(request);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.sectionWorkspace.findUnique({
      where: { projectId_sectionKey: { projectId, sectionKey } },
    });
    const payload = {
      ...jsonObject(existing?.draftPayload ?? null),
      ...fragment,
    } as Prisma.InputJsonObject;

    const workspace = await tx.sectionWorkspace.upsert({
      where: { projectId_sectionKey: { projectId, sectionKey } },
      create: {
        projectId,
        sectionKey,
        draftPayload: payload,
        draftSequence: 1,
        draftUpdatedAt: new Date(),
        draftActorKind: actor.actorKind,
        draftActorId: actor.actorId,
        draftActorName: actor.actorName,
        draftActorEmail: actor.actorEmail,
        draftActorRole: actor.actorRole,
      },
      update: {
        draftPayload: payload,
        draftSequence: { increment: 1 },
        draftUpdatedAt: new Date(),
        draftActorKind: actor.actorKind,
        draftActorId: actor.actorId,
        draftActorName: actor.actorName,
        draftActorEmail: actor.actorEmail,
        draftActorRole: actor.actorRole,
      },
    });

    await tx.sectionWorkspaceEvent.create({
      data: { workspaceId: workspace.id, action: "save", ...actor, summary },
    });
    return workspace;
  });
}

/** Статус: нет данных, зафиксировано, либо есть более свежий черновик. */
export function getWorkspaceFreshness(
  workspace: SectionWorkspace & { currentRevision: SectionRevision | null }
): DataFreshness {
  if (workspace.draftPayload === null) return "missing";
  if (
    workspace.currentRevision &&
    workspace.currentRevision.sourceDraftSequence === workspace.draftSequence
  ) {
    return "fresh";
  }
  return "stale";
}

export function toWorkspaceDto(
  workspace: SectionWorkspace & { currentRevision: SectionRevision | null }
) {
  return {
    id: workspace.id,
    projectId: workspace.projectId,
    sectionKey: workspace.sectionKey,
    draftSequence: workspace.draftSequence,
    draftUpdatedAt: workspace.draftUpdatedAt,
    draftActor: workspace.draftActorName
      ? {
          kind: workspace.draftActorKind,
          name: workspace.draftActorName,
          email: workspace.draftActorEmail,
          role: workspace.draftActorRole,
        }
      : null,
    freshness: getWorkspaceFreshness(workspace),
    currentRevision: workspace.currentRevision
      ? {
          id: workspace.currentRevision.id,
          version: workspace.currentRevision.version,
          fixedAt: workspace.currentRevision.fixedAt,
          fixedBy: workspace.currentRevision.actorName,
        }
      : null,
  };
}

/**
 * Правки v5: зафиксированный раздел нельзя менять обычным сохранением.
 * Редактирование снова открывается только после создания корректировки,
 * которая увеличивает draftSequence и тем самым отделяет черновик от версии.
 */
export async function isSectionDraftLocked(projectId: string, sectionKey: SectionKey) {
  const workspace = await prisma.sectionWorkspace.findUnique({
    where: { projectId_sectionKey: { projectId, sectionKey } },
    select: {
      draftSequence: true,
      currentRevision: { select: { sourceDraftSequence: true } },
    },
  });
  return Boolean(
    workspace?.currentRevision &&
    workspace.currentRevision.sourceDraftSequence === workspace.draftSequence,
  );
}
