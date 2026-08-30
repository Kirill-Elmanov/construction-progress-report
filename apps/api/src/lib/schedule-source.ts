import { prisma } from "./prisma.js";

export interface ManualScheduleRow {
  code: string;
  name: string;
  planStart?: string | null;
  planFinish?: string | null;
  delayDays?: number | null;
  percentDone?: number | null;
  weekGrowth?: number | null;
  planrWbsId?: string | null;
}

/**
 * Граница источника графика: ручной снимок хранится в PostgreSQL,
 * а при подключённом PLAN-R он обновляется отдельной командой синхронизации.
 * При подключении PLAN-R здесь появится второй адаптер с тем же результатом,
 * поэтому роут, таблица и права сотрудника КСП останутся неизменными.
 */
export const manualScheduleSource = {
  kind: "manual" as const,

  load(projectId: string) {
    return prisma.scheduleItem.findMany({
      where: { projectId },
      orderBy: { sortOrder: "asc" },
    });
  },

  async replace(projectId: string, rows: ManualScheduleRow[]) {
    await prisma.$transaction([
      prisma.scheduleItem.deleteMany({ where: { projectId } }),
      ...rows.map((row, index) => prisma.scheduleItem.create({
        data: {
          projectId,
          code: row.code.trim(),
          name: row.name.trim(),
          planStart: row.planStart ? new Date(row.planStart) : null,
          planFinish: row.planFinish ? new Date(row.planFinish) : null,
          delayDays: row.delayDays ?? null,
          percentDone: row.percentDone ?? null,
          weekGrowth: row.weekGrowth ?? null,
          planrWbsId: row.planrWbsId ?? null,
          sortOrder: index + 1,
        },
      })),
    ]);
    return this.load(projectId);
  },
};
