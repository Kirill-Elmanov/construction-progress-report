import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import {
  SECTION_DEFINITIONS,
  isReportLocked,
  normalizeSectionKey,
} from "@rost/shared/types";
import { canEditSection, getRequestAccess } from "./access.js";
import { getWorkspaceFreshness } from "./section-workspaces.js";
import { isWorkspaceUnfixed, parseEnabledSections } from "./final-report.js";
import { getPurgeAt, TRASH_TTL_DAYS } from "./project-lifecycle.js";
import {
  ACTIVATION_TTL_HOURS,
  activationExpiresAt,
  createActivationToken,
  hashActivationToken,
} from "./activation.js";

// ═══ ЭТАП 1: страховочные тесты доменных ключей и токенов ═════════

test("справочник содержит согласованные разделы А–И", () => {
  assert.deepEqual(
    SECTION_DEFINITIONS.map(({ key, letter }) => [key, letter]),
    [
      ["object", "А"],
      ["budget", "Б"],
      ["rd", "В"],
      ["worklog", "Г"],
      ["schedule", "Д"],
      ["prescriptions", "Е"],
      ["resources", "Ж"],
      ["issues", "З"],
      ["photos", "И"],
    ]
  );
});

test("старые литеры ссылок преобразуются без потери прав", () => {
  assert.equal(normalizeSectionKey("З"), "resources");
  assert.equal(normalizeSectionKey("И"), "issues");
  assert.equal(normalizeSectionKey("К"), "photos");
});

test("сотрудник КСП по ссылке редактирует только выданный график", () => {
  const request = {
    actor: {
      kind: "link",
      id: "link-id",
      name: "Сотрудник КСП",
      email: null,
      role: "ksp",
      tenantId: "tenant-id",
      grants: [{
        projectId: "project-id",
        projectName: "Тепличный комбинат",
        allowedSections: ["schedule"],
      }],
    },
  } as FastifyRequest;

  assert.equal(canEditSection(request, "project-id", "schedule"), true);
  assert.equal(canEditSection(request, "project-id", "budget"), false);
  assert.equal(canEditSection(request, "other-project", "schedule"), false);
});

test("наблюдатель не редактирует даже ошибочно выданную секцию", () => {
  const request = {
    actor: {
      kind: "link",
      id: "link-id",
      name: "Наблюдатель",
      email: null,
      role: "viewer",
      tenantId: "tenant-id",
      grants: [{
        projectId: "project-id",
        projectName: "Тепличный комбинат",
        allowedSections: ["schedule"],
      }],
    },
  } as FastifyRequest;

  assert.equal(canEditSection(request, "project-id", "schedule"), false);
});

test("общий токен открывает все проекты с одинаковыми правами", async () => {
  const request = {
    actor: {
      kind: "link",
      id: "link-id",
      name: "Специалист",
      email: "employee@example.test",
      role: "ksp",
      tenantId: "tenant-id",
      grants: [
        { projectId: "project-1", projectName: "Проект 1", allowedSections: ["schedule"] },
        { projectId: "project-2", projectName: "Проект 2", allowedSections: ["schedule"] },
      ],
    },
  } as FastifyRequest;

  const access = await getRequestAccess(request);
  assert.deepEqual(access?.projectIds, ["project-1", "project-2"]);
  assert.equal(canEditSection(request, "project-1", "schedule"), true);
  assert.equal(canEditSection(request, "project-2", "schedule"), true);
  assert.equal(canEditSection(request, "project-2", "budget"), false);
});

test("финализированная версия заблокирована, черновик — нет", () => {
  assert.equal(isReportLocked("draft"), false);
  assert.equal(isReportLocked("finalized"), true);
});

test("актуальность раздела различает пустой, изменённый и зафиксированный черновик", () => {
  const base = {
    draftPayload: null,
    draftSequence: 0,
    currentRevision: null,
  } as any;
  assert.equal(getWorkspaceFreshness(base), "missing");

  assert.equal(
    getWorkspaceFreshness({ ...base, draftPayload: { budget: {} }, draftSequence: 2 }),
    "stale"
  );
  assert.equal(
    getWorkspaceFreshness({
      ...base,
      draftPayload: { budget: {} },
      draftSequence: 2,
      currentRevision: { sourceDraftSequence: 2 },
    }),
    "fresh"
  );
});

test("финальный снимок блокирует только существующий незафиксированный черновик", () => {
  assert.equal(isWorkspaceUnfixed({
    draftPayload: null, draftSequence: 0, currentRevision: null,
  }), false);
  assert.equal(isWorkspaceUnfixed({
    draftPayload: { issues: [] }, draftSequence: 1, currentRevision: null,
  }), true);
  assert.equal(isWorkspaceUnfixed({
    draftPayload: { issues: [] }, draftSequence: 2,
    currentRevision: { sourceDraftSequence: 2 },
  }), false);
});

test("состав старого отчёта по умолчанию включает все канонические разделы", () => {
  assert.deepEqual(parseEnabledSections(null), SECTION_DEFINITIONS.map((section) => section.key));
  assert.deepEqual(parseEnabledSections(["object", "budget", "unknown"]), ["object", "budget"]);
});

test("проект хранится в корзине ровно 60 дней", () => {
  const deletedAt = new Date("2026-01-01T10:00:00.000Z");
  assert.equal(TRASH_TTL_DAYS, 60);
  assert.equal(getPurgeAt(deletedAt).toISOString(), "2026-03-02T10:00:00.000Z");
});

test("ссылка руководителя хранится как хеш и истекает через 72 часа", () => {
  const created = createActivationToken();
  assert.notEqual(created.token, created.tokenHash);
  assert.equal(created.tokenHash, hashActivationToken(created.token));
  assert.equal(ACTIVATION_TTL_HOURS, 72);
  assert.equal(
    activationExpiresAt(new Date("2026-01-01T00:00:00.000Z")).toISOString(),
    "2026-01-04T00:00:00.000Z"
  );
});
