import { Prisma, type Project, type Report } from "@prisma/client";
import {
  SECTION_KEYS,
  type SectionKey,
} from "@rost/shared/types";
import { prisma } from "./prisma.js";
import { buildSCurve, PROJECT_SCOPE_ID, selectCurveScopes } from "./s-curve.js";
import type { PlanrSnapshotRow } from "./planr-client.js";

export class UnfixedSectionsError extends Error {
  constructor(public sectionKeys: SectionKey[]) {
    super("В выбранных разделах есть незафиксированные изменения");
  }
}

/** Преобразуем карточку проекта в JSON без Date, Decimal и BigInt. */
function objectPayload(project: Project): Prisma.InputJsonObject {
  return {
    id: project.id,
    name: project.name,
    address: project.address,
    customer: project.customer,
    contractor: project.contractor,
    planStart: project.planStart.toISOString().slice(0, 10),
    planFinish: project.planFinish.toISOString().slice(0, 10),
    budget: Number(project.budget),
    tepArea: project.tepArea === null ? null : Number(project.tepArea),
    tepPower: project.tepPower,
    tepExtra: (project.tepExtra ?? null) as Prisma.InputJsonValue,
    techCustomer: project.techCustomer,
    generalDesigner: project.generalDesigner,
    expertiseConclusion: project.expertiseConclusion,
    buildPermit: project.buildPermit,
    technicalConditions: (project.technicalConditions ?? null) as Prisma.InputJsonValue,
    projectStage: project.projectStage,
  };
}

/**
 * Единственная точка выпуска отчёта. Проверка версий, создание снимков и
 * смена статуса выполняются одной транзакцией — частичного отчёта не бывает.
 */
export async function finalizeWithSnapshots(
  report: Report,
  enabledSections: SectionKey[],
  finalizerId: string
) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: report.projectId } });
    if (!project) throw new Error("Проект отчёта не найден");

    const localKeys = enabledSections.filter(
      (key) => key !== "object" && key !== "schedule"
    );
    const workspaces = await tx.sectionWorkspace.findMany({
      where: { projectId: project.id, sectionKey: { in: localKeys } },
      include: { currentRevision: true },
    });
    const byKey = new Map(workspaces.map((row) => [row.sectionKey, row]));

    const stale = localKeys.filter((key) => {
      const row = byKey.get(key);
      return row ? isWorkspaceUnfixed(row) : false;
    });
    if (stale.length) throw new UnfixedSectionsError(stale);

    const snapshots: Prisma.ReportSectionSnapshotCreateManyInput[] = [];
    for (const key of enabledSections) {
      if (key === "object") {
        snapshots.push({
          reportId: report.id,
          sectionKey: key,
          sourceKind: "project",
          payload: objectPayload(project),
        });
        continue;
      }

      if (key === "schedule") {
        if (project.scheduleReportMode === "s_curve") {
          const [storedRows, storedFacts] = await Promise.all([
            tx.planrScheduleItem.findMany({ where: { projectId: project.id }, orderBy: { sortOrder: "asc" } }),
            tx.planrProgressPoint.findMany({
              where: { projectId: project.id }, orderBy: { asOfDate: "asc" },
            }),
          ]);
          const rows: PlanrSnapshotRow[] = storedRows.map((row) => ({
            wbsId: row.wbsId, parentWbsId: row.parentWbsId, code: row.code, name: row.name,
            nodeType: row.nodeType,
            targetStart: row.targetStart?.toISOString().slice(0, 10) ?? null,
            targetFinish: row.targetFinish?.toISOString().slice(0, 10) ?? null,
            forecastStart: row.forecastStart?.toISOString().slice(0, 10) ?? null,
            forecastFinish: row.forecastFinish?.toISOString().slice(0, 10) ?? null,
            percentDone: row.percentDone == null ? null : Number(row.percentDone), sortOrder: row.sortOrder,
          }));
          const asOfDate = report.weekFriday.toISOString().slice(0, 10);
          const curves = selectCurveScopes(rows).map((scope) => ({
            scopeId: scope.id,
            scopeName: scope.name,
            scopeCode: scope.code,
            depth: scope.depth,
            points: buildSCurve(rows, scope.id, storedFacts
              .filter((point) => point.scopeWbsId === scope.id)
              .map((point) => ({
                date: point.asOfDate.toISOString().slice(0, 10), percent: Number(point.percentDone),
              })), asOfDate),
          }));
          const overall = curves.find((curve) => curve.scopeId === PROJECT_SCOPE_ID);
          snapshots.push({
            reportId: report.id,
            sectionKey: key,
            sourceKind: rows.length ? "project" : "empty",
            payload: rows.length ? {
              mode: "s_curve",
              scopeName: "Весь объект",
              asOfDate,
              points: overall?.points ?? [],
              curves,
            } : { empty: true },
          });
          continue;
        }
        const schedule = await tx.scheduleItem.findMany({
          where: { projectId: project.id },
          orderBy: { sortOrder: "asc" },
        });
        snapshots.push({
          reportId: report.id,
          sectionKey: key,
          sourceKind: schedule.length ? "project" : "empty",
          payload: {
            mode: "manual",
            items: schedule.map((item) => ({
              id: item.id,
              code: item.code,
              name: item.name,
              planStart: item.planStart?.toISOString().slice(0, 10) ?? null,
              planFinish: item.planFinish?.toISOString().slice(0, 10) ?? null,
              delayDays: item.delayDays,
              percentDone: item.percentDone === null ? null : Number(item.percentDone),
              weekGrowth: item.weekGrowth === null ? null : Number(item.weekGrowth),
              sortOrder: item.sortOrder,
            })),
          },
        });
        continue;
      }

      const workspace = byKey.get(key);
      const revision = workspace?.currentRevision;
      snapshots.push({
        reportId: report.id,
        sectionKey: key,
        sourceKind: revision ? "section_revision" : "empty",
        revisionId: revision?.id ?? null,
        payload: revision
          ? (revision.payload as Prisma.InputJsonValue)
          : { empty: true },
      });
    }

    if (snapshots.length) {
      await tx.reportSectionSnapshot.createMany({ data: snapshots });
    }
    const updated = await tx.report.updateMany({
      where: { id: report.id, status: "draft" },
      data: { status: "finalized", finalizedAt: new Date(), finalizedBy: finalizerId },
    });
    if (updated.count !== 1) throw new Error("Отчёт уже был финализирован");

    return tx.report.findUniqueOrThrow({
      where: { id: report.id },
      include: { snapshots: { orderBy: { sectionKey: "asc" } } },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Пустой раздел допустим, но существующий черновик обязан быть зафиксирован. */
export function isWorkspaceUnfixed(workspace: {
  draftPayload: Prisma.JsonValue | null;
  draftSequence: number;
  currentRevision: { sourceDraftSequence: number } | null;
}) {
  return workspace.draftPayload !== null && (
    !workspace.currentRevision ||
    workspace.currentRevision.sourceDraftSequence !== workspace.draftSequence
  );
}

/** Старые отчёты без снимков читаются прежними маршрутами и помечаются legacy. */
export function parseEnabledSections(value: Prisma.JsonValue | null): SectionKey[] {
  if (!Array.isArray(value)) return [...SECTION_KEYS];
  return value.filter((key): key is SectionKey =>
    typeof key === "string" && (SECTION_KEYS as readonly string[]).includes(key)
  );
}
