import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authGuard } from "../middleware/authGuard.js";
import { Errors } from "../lib/errors.js";
import { getCurrentFriday, formatDate } from "../lib/dates.js";
import { getRequestAccess, getUserRequestAccess, loadProjectWithAccess, loadReportWithAccess, canEditSection, canFinalizeReport } from "../lib/access.js";
import { recordAudit, getLastEditsBySection } from "../lib/audit.js";
import { SECTION_KEYS } from "@rost/shared/types";
import {
  finalizeWithSnapshots,
  parseEnabledSections,
  UnfixedSectionsError,
} from "../lib/final-report.js";
import { createReportPdf } from "../lib/report-pdf.js";
import { serializeReport } from "../lib/report-serialization.js";

/**
 * Отчёты за неделю (ТЗ Секция К, раздел 4.3)...
 */

const GLOBAL_ROLES = ["superadmin", "pzgd", "head_of_projects"];

interface PdfCurveOption {
  scopeId: string;
  scopeName: string;
  scopeCode: string | null;
  depth: number;
  points: unknown[];
}

function pdfCurveOptions(payload: unknown): PdfCurveOption[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const value = payload as Record<string, unknown>;
  if (Array.isArray(value.curves)) {
    return value.curves.filter((curve): curve is PdfCurveOption => Boolean(
      curve && typeof curve === "object" && typeof (curve as any).scopeId === "string"
      && typeof (curve as any).scopeName === "string" && Array.isArray((curve as any).points),
    ));
  }
  if (value.mode === "s_curve" && Array.isArray(value.points)) {
    return [{ scopeId: "__project__", scopeName: String(value.scopeName ?? "Весь объект"), scopeCode: null, depth: 0, points: value.points }];
  }
  return [];
}

// ── Роуты ──────────────────────────────────────────────────────────

export async function reportRoutes(app: FastifyInstance) {
  // ===================================================================
  // GET /projects/:id/reports — список недель проекта
  // ===================================================================
  app.get<{ Params: { id: string } }>(
    "/projects/:id/reports",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { project, denied } = await loadProjectWithAccess(request.params.id, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const reports = await prisma.report.findMany({
        where: { projectId: project.id },
        orderBy: [{ weekFriday: "desc" }, { version: "desc" }],
        select: {
          id: true,
          weekFriday: true,
          status: true,
          version: true,
          parentReportId: true,
          finalizedAt: true,
          createdAt: true,
        },
      });

      return reports;
    }
  );

  // ===================================================================
  // POST /projects/:id/reports — создать неделю (draft)
  //   авто-пятница + предзаполнение из последнего finalized (ТЗ 3.2)
  // ===================================================================
  app.post<{ Params: { id: string }; Body: { weekFriday?: string } }>(
    "/projects/:id/reports",
    { preHandler: authGuard },
    async (request, reply) => {
      // Правки v5: рабочая неделя может создаваться автоматически при первом
      // входе сотрудника на панель разделов. Права на сами разделы по-прежнему
      // проверяются каждым профильным маршрутом.
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { project, denied } = await loadProjectWithAccess(request.params.id, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");
      if (!SECTION_KEYS.some((sectionKey) => canEditSection(request, project.id, sectionKey))) {
        return Errors.forbidden(reply, "Нет прав на заполнение разделов отчёта");
      }

      // Дата пятницы: из тела (если передана) или авто-текущая (МСК)
      const weekFriday = request.body?.weekFriday
        ? new Date(request.body.weekFriday)
        : getCurrentFriday();

      // Проверка: нет ли уже отчёта на эту неделю (version 1)
      const existing = await prisma.report.findFirst({
        where: { projectId: project.id, weekFriday, version: 1 },
      });
      if (existing) {
        return Errors.conflict(
          reply,
          `Отчёт за неделю ${formatDate(weekFriday)} уже существует`
        );
      }

      // Создаём отчёт (draft, version 1)
      const report = await prisma.report.create({
        data: {
          projectId: project.id,
          weekFriday,
          status: "draft",
          version: 1,
        },
      });

      // ── ПРЕДЗАПОЛНЕНИЕ из прошлой недели (ТЗ 3.2, Секция В) ──────
      // Берём последний finalized-отчёт проекта и копируем прогресс разделов
      const prevReport = await prisma.report.findFirst({
        where: {
          projectId: project.id,
          status: "finalized",
          weekFriday: { lt: weekFriday },
        },
        orderBy: [{ weekFriday: "desc" }, { version: "desc" }],
      });

      let prefilled = 0;
      let previousProgress: Array<{ sectionId: string; isCritical: boolean }> = [];
      if (prevReport) {
        const prevProgress = await prisma.sectionProgress.findMany({
          where: { reportId: prevReport.id },
        });
        previousProgress = prevProgress.map((row) => ({
          sectionId: row.sectionId,
          isCritical: row.isCritical,
        }));

        // ── Секция Г: переносим АКТИВНЫЕ проблемы (🟡/🔴) — ТЗ Секция Г ──
        // 🟢 (устранённые) не переносим: они закрыты на прошлой неделе.
        const prevIssues = await prisma.issue.findMany({
          where: {
            reportId: prevReport.id,
            isArchived: false,
            status: { in: ["yellow", "red"] },
          },
        });
        if (prevIssues.length > 0) {
          await prisma.issue.createMany({
            data: prevIssues.map((i) => ({
              reportId: report.id,
              description: i.description,   // Г1
              status: i.status,             // Г2 — статус сохраняется
              action: i.action,             // Г3
              responsible: i.responsible,   // Г4
              dueDate: i.dueDate,           // Г5
              resolvedDate: null,           // Г6 — не устранена
              isArchived: false,
            })),
          });
        }

        // ── Секция Д: предписания нарастающим итогом — ТЗ Д1/Д2 ──
        const prevPresc = await prisma.prescription.findUnique({
          where: { reportId: prevReport.id },
        });
        if (prevPresc) {
          await prisma.prescription.create({
            data: {
              reportId: report.id,
              issuedTotal: prevPresc.issuedTotal,
              resolvedTotal: prevPresc.resolvedTotal,
            },
          });
        }

                // ── Секция В: разработка РД нарастающим итогом (ПР-6.4) ──
        const prevRd = await prisma.rdDevelopment.findUnique({
          where: { reportId: prevReport.id },
        });
        if (prevRd) {
          await prisma.rdDevelopment.create({
            data: {
              reportId: report.id,
              volumesTotal: prevRd.volumesTotal,
              handedToCustomer: prevRd.handedToCustomer,
              onReview: prevRd.onReview,
              issuedVpr: prevRd.issuedVpr,
              inProgress: prevRd.inProgress,
              withRemarks: prevRd.withRemarks,
            },
          });
        }

        // ── Секция Б: бюджет нарастающим итогом (ПР-6.3) ──
        const prevBudget = await prisma.budgetWeekly.findUnique({
          where: { reportId: prevReport.id },
        });
        if (prevBudget) {
          await prisma.budgetWeekly.create({
            data: {
              reportId: report.id,
              paidGp: prevBudget.paidGp,
              worksAccepted: 0n,
              spentTotal: prevBudget.paidGp,
              optionalFields: prevBudget.optionalFields as Prisma.InputJsonValue,
              comment: null,
            },
          });
        }

      }

      // Правки v3: руководитель получает в новом отчёте текущий процент и
      // фактические даты, которые исполнитель заполнил в карточках работ.
      const currentSections = await prisma.section.findMany({
        where: { projectId: project.id },
        select: { id: true, percentDone: true, factStart: true, factFinish: true },
      });
      if (currentSections.length > 0) {
        const previousBySection = new Map(
          previousProgress.map((row) => [row.sectionId, row]),
        );
        await prisma.sectionProgress.createMany({
          data: currentSections.map((section) => ({
            reportId: report.id,
            sectionId: section.id,
            percentDone: section.percentDone,
            factStart: section.factStart,
            factFinish: section.factFinish,
            comment: null,
            isCritical: previousBySection.get(section.id)?.isCritical ?? false,
          })),
        });
        prefilled = currentSections.length;
      }

      request.log.info(
        `✅ Отчёт создан: неделя ${formatDate(weekFriday)} (проект ${project.name})` +
          (prefilled ? ` · предзаполнено разделов: ${prefilled}` : " · без предзаполнения")
      );
      reply.code(201);
      return report;
    }
  );

  // ===================================================================
  // GET /reports/:id — все данные недели (все секции В–И)
  // ===================================================================
  app.get<{ Params: { id: string } }>(
    "/reports/:id",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const report = await prisma.report.findUnique({
        where: { id: request.params.id },
        include: {
          progress: { include: { section: true } }, // В
          issues: true, // Г
          prescription: true, // Д
          budget: true, // Е
          rdDevelopment: true, // В (ПР-6.4)
          resources: true, // Ж
          workLogs: { include: { contractor: true, section: true } }, // З
          photos: { orderBy: { sortOrder: "asc" } }, // И
        },
      });
      if (!report) return Errors.notFound(reply, "Отчёт не найден");

      // Проверка доступа через проект
      const { project, denied } = await loadProjectWithAccess(report.projectId, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      return serializeReport(report);
    }
  );

  // ===================================================================
  // POST /reports/:id/finalize — финализировать (draft→finalized) К4
  // ===================================================================
  app.post<{ Params: { id: string } }>(
    "/reports/:id/finalize",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      // Финализировать может global-админ (ПЗГД/Руководитель) — ТЗ Секция К
      // ПР-1.5: финализация — только вход по логину/паролю
      if (!canFinalizeReport(request)) {
        return Errors.forbidden(
          reply,
          "Сформировать отчёт может только руководитель (вход по логину и паролю)"
        );
      }
      if (!GLOBAL_ROLES.includes(access.role)) {
        return Errors.forbidden(reply, "Финализировать отчёт может только руководитель");
      }

      const report = await prisma.report.findUnique({ where: { id: request.params.id } });
      if (!report) return Errors.notFound(reply, "Отчёт не найден");

      const { project, denied } = await loadProjectWithAccess(report.projectId, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      if (report.status === "finalized") {
        return Errors.conflict(reply, "Отчёт уже финализирован");
      }

      let updated;
      try {
        updated = await finalizeWithSnapshots(
          report,
          parseEnabledSections(report.enabledSections),
          access.id
        );
      } catch (error) {
        if (error instanceof UnfixedSectionsError) {
          return Errors.conflict(
            reply,
            `Сначала зафиксируйте изменения разделов: ${error.sectionKeys.join(", ")}`
          );
        }
        throw error;
      }

      // TODO (позже): здесь вызов Cloud Function pdf-generator (ТЗ 4.7)
      request.log.info(`🏁 Отчёт финализирован: неделя ${formatDate(report.weekFriday)}`);
      await recordAudit(request, report.id, "report", "finalize", "Отчёт финализирован");
      return updated;
    }
  );

  // ===================================================================
  // GET /reports/:id/final-snapshot — канонические данные выпуска
  // ===================================================================
  app.get<{ Params: { id: string } }>(
    "/reports/:id/final-snapshot",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");
      if (report.status !== "finalized") {
        return Errors.conflict(reply, "Снимок доступен только после формирования отчёта");
      }

      const snapshots = await prisma.reportSectionSnapshot.findMany({
        where: { reportId: report.id },
        orderBy: { capturedAt: "asc" },
        include: {
          revision: { select: { version: true, fixedAt: true, actorName: true } },
        },
      });
      return {
        reportId: report.id,
        weekFriday: report.weekFriday,
        version: report.version,
        finalizedAt: report.finalizedAt,
        legacy: snapshots.length === 0,
        sections: snapshots.map((snapshot) => ({
          sectionKey: snapshot.sectionKey,
          sourceKind: snapshot.sourceKind,
          capturedAt: snapshot.capturedAt,
          revision: snapshot.revision,
          payload: snapshot.payload,
        })),
      };
    }
  );

  // Доступные неизменяемые S-кривые внутри финального снимка отчёта.
  app.get<{ Params: { id: string } }>(
    "/reports/:id/pdf-scopes",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");
      if (report.status !== "finalized") return Errors.conflict(reply, "PDF доступен только после формирования отчёта");
      const snapshot = await prisma.reportSectionSnapshot.findUnique({
        where: { reportId_sectionKey: { reportId: report.id, sectionKey: "schedule" } },
        select: { payload: true },
      });
      return pdfCurveOptions(snapshot?.payload).map(({ points: _points, ...option }) => option);
    },
  );

  // ===================================================================
  // GET /reports/:id/pdf — PDF только из неизменяемых снимков
  // ===================================================================
  app.get<{ Params: { id: string }; Querystring: { scope?: string } }>(
    "/reports/:id/pdf",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");
      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");
      if (report.status !== "finalized") {
        return Errors.conflict(reply, "PDF доступен только после формирования отчёта");
      }
      const [project, snapshots] = await Promise.all([
        prisma.project.findUnique({ where: { id: report.projectId }, select: { name: true } }),
        prisma.reportSectionSnapshot.findMany({
          where: { reportId: report.id }, orderBy: { capturedAt: "asc" },
        }),
      ]);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (!snapshots.length) {
        return Errors.conflict(reply, "Это исторический отчёт без финального снимка; сначала создайте корректировку");
      }
      // Обратная совместимость: старые снимки фотоотчёта сохраняли только
      // sectionId. Новые снимки уже содержат sectionName, а старым добавляем
      // читаемое имя при формировании PDF, чтобы исправление работало сразу.
      const photosSnapshot = snapshots.find((snapshot) => snapshot.sectionKey === "photos");
      const photosPayload = photosSnapshot?.payload && typeof photosSnapshot.payload === "object"
        && !Array.isArray(photosSnapshot.payload)
        ? photosSnapshot.payload as Record<string, unknown>
        : null;
      const photoRows = Array.isArray(photosPayload?.photos)
        ? photosPayload.photos.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
        : [];
      const missingPhotoSectionIds = [...new Set(photoRows.flatMap((row) =>
        !row.sectionName && typeof row.sectionId === "string" ? [row.sectionId] : []
      ))];
      const photoSectionRows = missingPhotoSectionIds.length
        ? await prisma.section.findMany({
          where: { projectId: report.projectId, id: { in: missingPhotoSectionIds } },
          select: { id: true, name: true },
        })
        : [];
      const photoSectionNames = new Map(photoSectionRows.map((row) => [row.id, row.name]));
      const snapshotsWithPhotoNames = photoSectionNames.size ? snapshots.map((snapshot) => {
        if (snapshot.sectionKey !== "photos" || !snapshot.payload || typeof snapshot.payload !== "object"
          || Array.isArray(snapshot.payload)) return snapshot;
        const payload = snapshot.payload as Record<string, unknown>;
        if (!Array.isArray(payload.photos)) return snapshot;
        return {
          ...snapshot,
          payload: {
            ...payload,
            photos: payload.photos.map((photo) => {
              if (!photo || typeof photo !== "object" || Array.isArray(photo)) return photo;
              const row = photo as Record<string, unknown>;
              return {
                ...row,
                sectionName: row.sectionName
                  ?? (typeof row.sectionId === "string" ? photoSectionNames.get(row.sectionId) ?? null : null),
              };
            }),
          } as unknown as Prisma.JsonValue,
        };
      }) : snapshots;
      const requestedScope = request.query.scope;
      const scheduleSnapshot = snapshotsWithPhotoNames.find((snapshot) => snapshot.sectionKey === "schedule");
      const curves = pdfCurveOptions(scheduleSnapshot?.payload);
      const selectedCurve = requestedScope
        ? curves.find((curve) => curve.scopeId === requestedScope)
        : curves.find((curve) => curve.scopeId === "__project__") ?? curves[0];
      if (requestedScope && !selectedCurve) {
        return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Выбранный раздел отсутствует в снимке отчёта" } });
      }
      const pdfSnapshots = selectedCurve ? snapshotsWithPhotoNames.map((snapshot) => {
        if (snapshot.sectionKey !== "schedule" || !snapshot.payload || typeof snapshot.payload !== "object"
          || Array.isArray(snapshot.payload)) return snapshot;
        return {
          ...snapshot,
          payload: {
            ...(snapshot.payload as Record<string, unknown>),
            scopeName: selectedCurve.scopeCode
              ? `${selectedCurve.scopeCode} · ${selectedCurve.scopeName}` : selectedCurve.scopeName,
            points: selectedCurve.points,
          } as unknown as Prisma.JsonValue,
        };
      }) : snapshotsWithPhotoNames;
      const pdf = await createReportPdf({
        reportId: report.id, projectName: project.name,
        weekFriday: report.weekFriday, version: report.version,
        finalizedAt: report.finalizedAt, snapshots: pdfSnapshots,
      });
      const safeDate = report.weekFriday.toISOString().slice(0, 10);
      reply.header("Content-Type", "application/pdf");
      reply.header("Content-Disposition", `attachment; filename="rost-report-${safeDate}-v${report.version}.pdf"`);
      return reply.send(pdf);
    }
  );

  // ===================================================================
  // POST /reports/:id/amend — корректировка (новая version) ТЗ К
  //   Только ПЗГД, только для ПОСЛЕДНЕГО finalized-отчёта недели
  // ===================================================================
  app.post<{ Params: { id: string } }>(
    "/reports/:id/amend",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      // Корректировка — только global-админы (ТЗ: «только ПЗГД»)
      if (!GLOBAL_ROLES.includes(access.role)) {
        return Errors.forbidden(reply, "Создавать корректировку может только руководитель");
      }

      const report = await prisma.report.findUnique({ where: { id: request.params.id } });
      if (!report) return Errors.notFound(reply, "Отчёт не найден");

      const { project, denied } = await loadProjectWithAccess(report.projectId, access);
      if (!project) return Errors.notFound(reply, "Проект не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      // Корректировать можно только finalized
      if (report.status !== "finalized") {
        return Errors.conflict(reply, "Корректировка возможна только для финализированного отчёта");
      }

      // Проверка: это ПОСЛЕДНЯЯ версия этой недели (ТЗ: старые — read-only)
      const latest = await prisma.report.findFirst({
        where: { projectId: report.projectId, weekFriday: report.weekFriday },
        orderBy: { version: "desc" },
      });
      if (!latest || latest.version !== report.version) {
        return Errors.conflict(
          reply,
          "Корректировать можно только последнюю версию отчёта за неделю"
        );
      }

      // Создаём новую версию (копия данных → снова draft)
      const newReport = await prisma.report.create({
        data: {
          projectId: report.projectId,
          weekFriday: report.weekFriday,
          status: "draft",
          version: report.version + 1,
          parentReportId: report.id,
        },
      });

      // ── Копирование данных секций В–И в новую версию (ТЗ Секция К) ──
      const [oldProgress, oldIssues, oldPresc, oldBudget, oldRes, oldWork, oldPhotos, oldRd] =
        await Promise.all([
          prisma.sectionProgress.findMany({ where: { reportId: report.id } }),
          prisma.issue.findMany({ where: { reportId: report.id } }),
          prisma.prescription.findUnique({ where: { reportId: report.id } }),
          prisma.budgetWeekly.findUnique({ where: { reportId: report.id } }),
          prisma.resourcesWeekly.findUnique({ where: { reportId: report.id } }),
          prisma.workLog.findMany({ where: { reportId: report.id } }),
          prisma.photo.findMany({ where: { reportId: report.id } }),
          prisma.rdDevelopment.findUnique({ where: { reportId: report.id } }),
        ]);

      // В — разработка РД (ПР-6.4)
      if (oldRd) {
        await prisma.rdDevelopment.create({
          data: {
            reportId: newReport.id,
            volumesTotal: oldRd.volumesTotal,
            handedToCustomer: oldRd.handedToCustomer,
            onReview: oldRd.onReview,
            issuedVpr: oldRd.issuedVpr,
            inProgress: oldRd.inProgress,
            withRemarks: oldRd.withRemarks,
          },
        });
      }

      // В — прогресс
      if (oldProgress.length) {
        await prisma.sectionProgress.createMany({
          data: oldProgress.map((p) => ({
            reportId: newReport.id,
            sectionId: p.sectionId,
            percentDone: p.percentDone,
            factStart: p.factStart,
            factFinish: p.factFinish,
            comment: p.comment,
            isCritical: p.isCritical,
          })),
        });
      }

      // Г — проблематика
      if (oldIssues.length) {
        await prisma.issue.createMany({
          data: oldIssues.map((i) => ({
            reportId: newReport.id,
            description: i.description,
            status: i.status,
            action: i.action,
            responsible: i.responsible,
            dueDate: i.dueDate,
            resolvedDate: i.resolvedDate,
            isArchived: i.isArchived,
          })),
        });
      }

      // Д — предписания
      if (oldPresc) {
        await prisma.prescription.create({
          data: {
            reportId: newReport.id,
            issuedTotal: oldPresc.issuedTotal,
            resolvedTotal: oldPresc.resolvedTotal,
          },
        });
      }

      // Б — бюджет: Б1 и настраиваемые показатели сохраняются в корректировке.
      if (oldBudget) {
        await prisma.budgetWeekly.create({
          data: {
            reportId: newReport.id,
            paidGp: oldBudget.paidGp,
            worksAccepted: 0n,
            spentTotal: oldBudget.paidGp,
            optionalFields: oldBudget.optionalFields as Prisma.InputJsonValue,
            rdStage: oldBudget.rdStage,
            comment: oldBudget.comment,
          },
        });
      }

      // Ж — ресурсы
      if (oldRes) {
        await prisma.resourcesWeekly.create({
          data: {
            reportId: newReport.id,
            itr: oldRes.itr,
            workers: oldRes.workers,
            machinery: oldRes.machinery,
            comment: oldRes.comment,
          },
        });
      }

      // Г — выполняемые работы (ПР-6.5)
      if (oldWork.length) {
        await prisma.workLog.createMany({
          data: oldWork.map((w) => ({
            reportId: newReport.id,
            contractorId: w.contractorId,
            sectionId: w.sectionId,
            description: w.description,
            percentDone: w.percentDone,
          })),
        });
      }

      // И — фото (ссылки на те же файлы в хранилище)
      if (oldPhotos.length) {
        await prisma.photo.createMany({
          data: oldPhotos.map((p) => ({
            reportId: newReport.id,
            storageKey: p.storageKey,
            thumbKey: p.thumbKey,
            caption: p.caption,
            sectionId: p.sectionId,
            shotDate: p.shotDate,
            sortOrder: p.sortOrder,
          })),
        });
      }

      request.log.info(
        `📝 Корректировка: неделя ${formatDate(report.weekFriday)} v${newReport.version}` +
          ` · скопировано: В=${oldProgress.length} Г=${oldIssues.length} З=${oldWork.length} И=${oldPhotos.length}`
      );
      reply.code(201);
      return newReport;
    }
  );

    // ===================================================================
  // DELETE /reports/:id — удалить отчёт (ПР-1.1)
  // Право: superadmin, pzgd, head_of_projects, gip, gip_deputy, coordinator
  // ===================================================================
  const REPORT_DELETE_ROLES = [
    "superadmin", "pzgd", "head_of_projects", "gip", "gip_deputy", "coordinator",
  ];

  app.delete<{ Params: { id: string } }>(
    "/reports/:id",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      if (!REPORT_DELETE_ROLES.includes(access.role)) {
        return Errors.forbidden(reply, "Недостаточно прав для удаления отчёта");
      }

      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      // Нельзя удалить отчёт, у которого есть корректировки (сначала удали их)
      const children = await prisma.report.count({
        where: { parentReportId: report.id },
      });
      if (children > 0) {
        return Errors.forbidden(
          reply,
          `У отчёта есть корректировки (${children}). Сначала удалите их.`
        );
      }

      // Секции удаляются каскадом (onDelete: Cascade в схеме)
      await prisma.report.delete({ where: { id: report.id } });

      request.log.info(
        `🗑️ Отчёт удалён: неделя ${report.weekFriday.toISOString().slice(0, 10)} v${report.version}`
      );
      return { success: true };
    }
  );

    // ===================================================================
  // PATCH /reports/:id/sections-config — вкл/выкл секции (ПР-5.1)
  // ===================================================================
  app.patch<{ Params: { id: string }; Body: { enabledSections?: string[] } }>(
    "/reports/:id/sections-config",
    { preHandler: authGuard },
    async (
      request,
      reply
    ) => {
      const access = await getUserRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      if (report.status === "finalized") {
        return Errors.conflict(reply, "Отчёт финализирован — состав секций изменить нельзя");
      }

      const parsed = z
        .object({ enabledSections: z.array(z.enum(SECTION_KEYS)).max(20) })
        .safeParse(request.body);
      if (!parsed.success) {
        return Errors.validation(reply, { message: "Ожидается массив ключей секций" });
      }

      const updated = await prisma.report.update({
        where: { id: report.id },
        data: { enabledSections: parsed.data.enabledSections },
      });

      request.log.info(
        `⚙️ Состав секций отчёта обновлён: [${parsed.data.enabledSections.join(", ")}]`
      );
      return { enabledSections: updated.enabledSections };
    }
  );

  // ===================================================================
  // GET /reports/:id/audit — кто какие секции заполнял (ПР-1.5, К4)
  // ===================================================================
  app.get<{ Params: { id: string } }>(
    "/reports/:id/audit",
    { preHandler: authGuard },
    async (request, reply) => {
      const access = await getRequestAccess(request);
      if (!access) return Errors.unauthorized(reply, "Пользователь не найден");

      const { report, denied } = await loadReportWithAccess(request.params.id, access);
      if (!report) return Errors.notFound(reply, "Отчёт не найден");
      if (denied) return Errors.forbidden(reply, "Нет доступа к этому проекту");

      const lastEdits = await getLastEditsBySection(report.id);

      const bySection: Record<string, unknown> = {};
      for (const [key, row] of lastEdits) {
        bySection[key] = {
          actorName: row.actorName,
          actorRole: row.actorRole,
          actorKind: row.actorKind,
          at: row.createdAt,
        };
      }

      // Полная история — последние 100 записей
      const history = await prisma.sectionAudit.findMany({
        where: { reportId: report.id },
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      return { bySection, history };
    }
  );
}
