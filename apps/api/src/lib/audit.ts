import type { FastifyRequest } from "fastify";
import type { SectionKey } from "@rost/shared/types";
import { prisma } from "./prisma.js";

/**
 * ПР-1.5: запись в аудит — кто, когда и что менял в секции.
 * Никогда не бросает исключение: сбой аудита не должен ломать сохранение.
 */
export async function recordAudit(
  request: FastifyRequest,
  reportId: string,
  sectionKey: SectionKey | "report",
  action: "save" | "finalize" | "amend" | "delete",
  summary?: string
): Promise<void> {
  const actor = request.actor;
  if (!actor) return;

  try {
    await prisma.sectionAudit.create({
      data: {
        reportId,
        sectionKey,
        action,
        actorKind: actor.kind,
        actorUserId: actor.kind === "user" ? actor.id : null,
        actorLinkId: actor.kind === "link" ? actor.id : null,
        actorName: actor.name,
        actorEmail: actor.email,
        actorRole: actor.role,
        summary: summary ?? null,
      },
    });
  } catch (e) {
    request.log.warn(`⚠️ Не удалось записать аудит: ${(e as Error).message}`);
  }
}

/** Последняя правка по каждой секции отчёта (для диалога К4). */
export async function getLastEditsBySection(reportId: string) {
  const rows = await prisma.sectionAudit.findMany({
    where: { reportId, action: "save" },
    orderBy: { createdAt: "desc" },
  });

  const map = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (!map.has(r.sectionKey)) map.set(r.sectionKey, r);
  }
  return map;
}
