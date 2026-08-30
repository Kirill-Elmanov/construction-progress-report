import type { FastifyInstance, FastifyRequest } from "fastify";
import "@fastify/multipart";
import { createReadStream } from "node:fs";
import { z } from "zod";
import sharp from "sharp";
import exifr from "exifr";
import { prisma } from "../lib/prisma.js";
import { authGuard } from "../middleware/authGuard.js";
import { Errors } from "../lib/errors.js";
import { getRequestAccess, canEditSection, loadReportWithAccess } from "../lib/access.js";
import { recordAudit } from "../lib/audit.js";
import { makeKey, saveFile, deleteFile, getAbsPath } from "../lib/storage.js";
import { isSectionDraftLocked, mergeSectionDraft } from "../lib/section-workspaces.js";

/**
 * Фотоотчёт [Секция И, ТЗ 4.3]. Роль: Стройконтроль.
 *   POST   /reports/:id/photos          Загрузка фото (multipart, сжатие)
 *   PATCH  /photos/:pid                  И2 caption / И3 sectionId / И4 shotDate
 *   DELETE /photos/:pid                  Удалить фото + файлы
 *   PATCH  /reports/:id/photos/reorder   Порядок галереи
 *   GET    /photos/:pid/file             Отдать оригинал
 *   GET    /photos/:pid/thumb            Отдать превью
 */

const MAX_SIZE = 10 * 1024 * 1024; // 10 МБ (И1)
const MAX_PER_REPORT = 20; // до 20 фото/неделя (И1)
const ALLOWED = new Set(["image/jpeg", "image/png", "image/heic", "image/heif"]);

// ── helper: map записи в ответ ───────────────────────────────────
function toDto(p: {
  id: string;
  caption: string | null;
  sectionId: string | null;
  shotDate: Date | null;
  sortOrder: number;
}) {
  return {
    id: p.id,
    caption: p.caption,
    sectionId: p.sectionId,
    shotDate: p.shotDate ? p.shotDate.toISOString().slice(0, 10) : null,
    sortOrder: p.sortOrder,
    fileUrl: `/api/v1/photos/${p.id}/file`,
    thumbUrl: `/api/v1/photos/${p.id}/thumb`,
  };
}

export async function photoRoutes(app: FastifyInstance) {
  // ── POST /reports/:id/photos ───────────────────────────────────
  app.post<{ Params: { id: string } }>(
    "/reports/:id/photos",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");
      if (report.status !== "draft") {
        return Errors.conflict(reply, "Отчёт финализирован — редактирование запрещено");
      }

      if (!canEditSection(request, report.projectId, "photos")) {
        return Errors.forbidden(reply, "Ваша ссылка-доступ не даёт права редактировать эту секцию");
      }
      if (await isSectionDraftLocked(report.projectId, "photos")) {
        return Errors.conflict(reply, "Раздел зафиксирован — сначала создайте корректировку");
      }

      // лимит 20 фото
      const count = await prisma.photo.count({ where: { reportId: report.id } });
      if (count >= MAX_PER_REPORT) {
        return Errors.validation(reply, {
          formErrors: [`Максимум ${MAX_PER_REPORT} фото на отчёт`],
          fieldErrors: {},
        });
      }

      const file = await request.file({ limits: { fileSize: MAX_SIZE } });
      if (!file) {
        return Errors.validation(reply, { formErrors: ["Файл не передан"], fieldErrors: {} });
      }
      if (!ALLOWED.has(file.mimetype)) {
        return Errors.validation(reply, {
          formErrors: ["Только JPG, PNG или HEIC"],
          fieldErrors: {},
        });
      }

      const buf = await file.toBuffer();
      if (file.file.truncated) {
        return Errors.validation(reply, {
          formErrors: ["Файл больше 10 МБ"],
          fieldErrors: {},
        });
      }

      // EXIF дата съёмки (И4) — без падения, если нет
      let shotDate: Date | null = null;
      try {
        const meta = await exifr.parse(buf, ["DateTimeOriginal", "CreateDate"]);
        const d = meta?.DateTimeOriginal ?? meta?.CreateDate;
        if (d instanceof Date && !isNaN(d.getTime())) shotDate = d;
      } catch {
        /* нет EXIF — ок */
      }

      // сжатие: оригинал (ресайз до 1920, q80 ~800КБ) + thumb (400px)
      const mainKey = makeKey(report.id, "jpg");
      const thumbKey = makeKey(report.id, "jpg");
      const mainBuf = await sharp(buf)
        .rotate() // авто-поворот по EXIF
        .resize(1920, 1920, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      const thumbBuf = await sharp(buf)
        .rotate()
        .resize(400, 400, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer();

      await saveFile(mainKey, mainBuf);
      await saveFile(thumbKey, thumbBuf);

      const maxOrder = await prisma.photo.aggregate({
        where: { reportId: report.id },
        _max: { sortOrder: true },
      });

      const photo = await prisma.photo.create({
        data: {
          reportId: report.id,
          storageKey: mainKey,
          thumbKey: thumbKey,
          caption: null,
          sectionId: null,
          shotDate,
          sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
        },
      });

      await recordAudit(request, report.id, "photos", "save", "Загружено фото");
      await syncPhotosDraft(request, report.id, report.projectId, "Фото добавлено в черновик");

      return { data: toDto(photo), warnings: [] };
    }
  );

  // ── GET /reports/:id/photos ────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    "/reports/:id/photos",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const rows = await prisma.photo.findMany({
        where: { reportId: report.id },
        orderBy: { sortOrder: "asc" },
      });
      return { items: rows.map(toDto) };
    }
  );

  // ── PATCH /photos/:pid — И2/И3/И4 ──────────────────────────────
  const patchSchema = z.object({
    caption: z.string().max(150, "Максимум 150 символов").nullable().optional(), // И2
    sectionId: z.string().uuid().nullable().optional(), // И3
    shotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Формат YYYY-MM-DD").nullable().optional(), // И4
  });

  app.patch<{ Params: { pid: string }; Body: unknown }>(
    "/photos/:pid",
    { preHandler: authGuard },
    async (
      request,
      reply
    ) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const photo = await prisma.photo.findUnique({ where: { id: request.params.pid } });
      if (!photo) return Errors.notFound(reply, "Фото не найдено");

      const { report, denied } = await loadReportWithAccess(photo.reportId, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");
      if (report.status !== "draft") {
        return Errors.conflict(reply, "Отчёт финализирован — редактирование запрещено");
      }
      if (!canEditSection(request, report.projectId, "photos")) {
        return Errors.forbidden(reply, "Ваша ссылка-доступ не даёт права редактировать эту секцию");
      }
      if (await isSectionDraftLocked(report.projectId, "photos")) {
        return Errors.conflict(reply, "Раздел зафиксирован — сначала создайте корректировку");
      }

      const parsed = patchSchema.safeParse(request.body);
      if (!parsed.success) return Errors.validation(reply, parsed.error.flatten());
      const b = parsed.data;

      const updated = await prisma.photo.update({
        where: { id: photo.id },
        data: {
          ...(b.caption !== undefined ? { caption: b.caption } : {}),
          ...(b.sectionId !== undefined ? { sectionId: b.sectionId } : {}),
          ...(b.shotDate !== undefined
            ? { shotDate: b.shotDate ? new Date(b.shotDate) : null }
            : {}),
        },
      });

      await recordAudit(request, report.id, "photos", "save", "Изменены данные фото");
      await syncPhotosDraft(request, report.id, report.projectId, "Изменены данные фото в черновике");

      return { data: toDto(updated), warnings: [] };
    }
  );

  // ── DELETE /photos/:pid ────────────────────────────────────────
  app.delete<{ Params: { pid: string } }>(
    "/photos/:pid",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const photo = await prisma.photo.findUnique({ where: { id: request.params.pid } });
      if (!photo) return Errors.notFound(reply, "Фото не найдено");

      const { report, denied } = await loadReportWithAccess(photo.reportId, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");
      if (report.status !== "draft") {
        return Errors.conflict(reply, "Отчёт финализирован — редактирование запрещено");
      }

      if (!canEditSection(request, report.projectId, "photos")) {
        return Errors.forbidden(reply, "Ваша ссылка-доступ не даёт права редактировать эту секцию");
      }
      if (await isSectionDraftLocked(report.projectId, "photos")) {
        return Errors.conflict(reply, "Раздел зафиксирован — сначала создайте корректировку");
      }

      await deleteFile(photo.storageKey);
      await deleteFile(photo.thumbKey);
      await prisma.photo.delete({ where: { id: photo.id } });

      await recordAudit(request, report.id, "photos", "delete", "Фото удалено");
      await syncPhotosDraft(request, report.id, report.projectId, "Фото удалено из черновика");

      return { data: { id: photo.id }, warnings: [] };
    }
  );

  // ── PATCH /reports/:id/photos/reorder ──────────────────────────
  const reorderSchema = z.object({ order: z.array(z.string().uuid()).min(1) });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/reports/:id/photos/reorder",
    { preHandler: authGuard },
    async (
      request,
      reply
    ) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");
      if (report.status !== "draft") {
        return Errors.conflict(reply, "Отчёт финализирован — редактирование запрещено");
      }

      if (!canEditSection(request, report.projectId, "photos")) {
        return Errors.forbidden(reply, "Ваша ссылка-доступ не даёт права редактировать эту секцию");
      }
      if (await isSectionDraftLocked(report.projectId, "photos")) {
        return Errors.conflict(reply, "Раздел зафиксирован — сначала создайте корректировку");
      }

      const parsed = reorderSchema.safeParse(request.body);
      if (!parsed.success) return Errors.validation(reply, parsed.error.flatten());

      await prisma.$transaction(
        parsed.data.order.map((pid, idx) =>
          prisma.photo.updateMany({
            where: { id: pid, reportId: report.id },
            data: { sortOrder: idx + 1 },
          })
        )
      );

      await recordAudit(request, report.id, "photos", "save", "Изменён порядок фото");
      await syncPhotosDraft(request, report.id, report.projectId, "Изменён порядок фото в черновике");

      return { data: { ok: true }, warnings: [] };
    }
  );

  // ── GET /photos/:pid/file и /thumb — отдача ────────────────────
  async function streamPhoto(
    request: FastifyRequest<{ Params: { pid: string } }>,
    reply: any,
    which: "main" | "thumb"
  ) {
    const access = await getRequestAccess(request);
    if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

    const photo = await prisma.photo.findUnique({ where: { id: request.params.pid } });
    if (!photo) return Errors.notFound(reply, "Фото не найдено");

    const { report, denied } = await loadReportWithAccess(photo.reportId, access);
    if (!report) return Errors.notFound(reply, "Отчёт не найден");
    if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

    const key = which === "main" ? photo.storageKey : photo.thumbKey;
    reply.header("Content-Type", "image/jpeg");
    return reply.send(createReadStream(getAbsPath(key)));
  }

  app.get<{ Params: { pid: string } }>(
    "/photos/:pid/file",
    { preHandler: authGuard },
    (request, reply) =>
      streamPhoto(request, reply, "main")
  );
  app.get<{ Params: { pid: string } }>(
    "/photos/:pid/thumb",
    { preHandler: authGuard },
    (request, reply) =>
      streamPhoto(request, reply, "thumb")
  );
}

// После любой операции сохраняем полный список: версия фотоотчёта должна
// воспроизводить не только подписи, но и точный порядок файлов.
async function syncPhotosDraft(
  request: FastifyRequest,
  reportId: string,
  projectId: string,
  summary: string
) {
  const photos = await prisma.photo.findMany({
    where: { reportId },
    orderBy: { sortOrder: "asc" },
    include: { section: { select: { name: true } } },
  });
  await mergeSectionDraft(
    request,
    projectId,
    "photos",
    {
      photos: photos.map((photo) => ({
        ...toDto(photo),
        // Снимок должен быть самодостаточным: PDF не должен показывать UUID
        // и не должен зависеть от последующего переименования справочника.
        sectionName: photo.section?.name ?? null,
        storageKey: photo.storageKey,
        thumbKey: photo.thumbKey,
      })),
    },
    summary
  );
}
