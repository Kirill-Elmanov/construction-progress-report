import { prisma } from "./prisma.js";
import { deleteFile } from "./storage.js";

export const TRASH_TTL_DAYS = 60;
const DAY_MS = 86_400_000;

/**
 * Окончательно удаляет проект и все принадлежащие ему файлы.
 * Сначала удаляем БД одной каскадной операцией. Файлы чистим после успешного
 * коммита, чтобы сбой БД никогда не оставил живые записи без изображений.
 */
export async function purgeProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      previewPhotoKey: true,
      reports: {
        select: {
          pdfKey: true,
          photos: { select: { storageKey: true, thumbKey: true } },
        },
      },
    },
  });
  if (!project) return { deleted: false, filesRemoved: 0 };

  const keys = new Set<string>();
  if (project.previewPhotoKey) keys.add(project.previewPhotoKey);
  for (const report of project.reports) {
    if (report.pdfKey) keys.add(report.pdfKey);
    for (const photo of report.photos) {
      keys.add(photo.storageKey);
      keys.add(photo.thumbKey);
    }
  }

  await prisma.project.delete({ where: { id: project.id } });
  await Promise.all([...keys].map((key) => deleteFile(key)));
  return { deleted: true, filesRemoved: keys.size };
}

/** Ленивая очистка вызывается при открытии корзины; позже её вызовет cron. */
export async function purgeExpiredProjects(tenantId: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - TRASH_TTL_DAYS * DAY_MS);
  const expired = await prisma.project.findMany({
    where: { tenantId, deletedAt: { lt: cutoff } },
    select: { id: true, name: true },
  });
  const results = [];
  for (const project of expired) {
    results.push({ project, result: await purgeProject(project.id) });
  }
  return results;
}

export function getPurgeAt(deletedAt: Date) {
  return new Date(deletedAt.getTime() + TRASH_TTL_DAYS * DAY_MS);
}
