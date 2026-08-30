import assert from "node:assert/strict";
import test from "node:test";
import { buildSCurve, PROJECT_SCOPE_ID, scopePercent, selectCurveScopes } from "./s-curve.js";
import type { PlanrSnapshotRow } from "./planr-client.js";

const rows: PlanrSnapshotRow[] = [
  { wbsId: "b", parentWbsId: null, code: "S1570", name: "Блок 2. Огурец", nodeType: "work", targetStart: "2026-01-01", targetFinish: "2026-12-31", forecastStart: "2026-02-01", forecastFinish: "2027-02-01", percentDone: 40, sortOrder: 1 },
  { wbsId: "t", parentWbsId: "b", code: "S1580", name: "Фундаменты", nodeType: "task", targetStart: "2026-01-01", targetFinish: "2026-06-30", forecastStart: "2026-02-01", forecastFinish: "2026-08-31", percentDone: 40, sortOrder: 2 },
];

test("S-кривая выделяет здание и сохраняет факт на дату отчёта", () => {
  assert.equal(selectCurveScopes(rows)[1].code, "S1570");
  assert.equal(scopePercent(rows, PROJECT_SCOPE_ID), 40);
  const curve = buildSCurve(rows, "b", [{ date: "2026-08-28", percent: 40 }], "2026-08-28");
  const current = curve.find((point) => point.date === "2026-08-28");
  assert.equal(current?.fact, 40);
  assert.equal(current?.forecast, 40);
});

test("план выбранного раздела завершается на его целевом финише", () => {
  const scopedRows: PlanrSnapshotRow[] = [
    { wbsId: "block", parentWbsId: null, code: "S1080", name: "Блок 1", nodeType: "work", targetStart: "2025-03-14", targetFinish: "2026-09-30", forecastStart: "2025-03-14", forecastFinish: "2026-09-30", percentDone: 80, sortOrder: 1 },
    { wbsId: "late", parentWbsId: "block", code: "S1090", name: "Поздняя дочерняя работа", nodeType: "task", targetStart: "2026-01-01", targetFinish: "2026-12-24", forecastStart: "2026-01-01", forecastFinish: "2026-12-24", percentDone: 50, sortOrder: 2 },
  ];
  const curve = buildSCurve(scopedRows, "block", [{ date: "2026-09-04", percent: 80 }], "2026-09-04");
  assert.equal(curve.find((point) => point.date === "2026-09-30")?.plan, 100);
});

test("процедура ввода и её дочерние работы исключены из S-кривой", () => {
  const scopedRows: PlanrSnapshotRow[] = [
    { wbsId: "root", parentWbsId: null, code: "S1000", name: "Проект", nodeType: "work", targetStart: "2025-01-01", targetFinish: "2027-04-30", forecastStart: "2025-01-01", forecastFinish: "2027-04-30", percentDone: null, sortOrder: 1 },
    { wbsId: "build", parentWbsId: "root", code: "S1010", name: "Строительство", nodeType: "work", targetStart: "2025-01-01", targetFinish: "2027-04-30", forecastStart: "2025-01-01", forecastFinish: "2027-04-30", percentDone: 50, sortOrder: 2 },
    { wbsId: "task", parentWbsId: "build", code: "S1020", name: "Работа", nodeType: "task", targetStart: "2025-01-01", targetFinish: "2027-04-30", forecastStart: "2025-01-01", forecastFinish: "2027-04-30", percentDone: 50, sortOrder: 3 },
    { wbsId: "commission", parentWbsId: "root", code: "S7420", name: "Процедура ввода", nodeType: "work", targetStart: "2027-03-01", targetFinish: "2027-11-01", forecastStart: "2027-03-01", forecastFinish: "2027-11-01", percentDone: 0, sortOrder: 4 },
    { wbsId: "commission-task", parentWbsId: "commission", code: "S7430", name: "Подписание", nodeType: "task", targetStart: "2027-03-01", targetFinish: "2027-03-15", forecastStart: "2027-03-01", forecastFinish: "2027-03-15", percentDone: 0, sortOrder: 5 },
  ];
  const scopes = selectCurveScopes(scopedRows);
  assert.equal(scopes.some((scope) => scope.code === "S1010"), true);
  assert.equal(scopes.some((scope) => scope.code === "S7420"), false);
  assert.equal(scopePercent(scopedRows, PROJECT_SCOPE_ID), 50);
});
