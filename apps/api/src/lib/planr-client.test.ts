import assert from "node:assert/strict";
import test from "node:test";
import { deduplicatePlanrNodes, mapPlanrSchedule, mapPlanrSnapshot } from "./planr-client.js";

test("дубли работ на границе страниц PLAN-R удаляются по id", () => {
  const rows = deduplicatePlanrNodes([
    { id: "wbs-1", code: "S1570", name: "Старое значение" },
    { id: "wbs-1", code: "S1570", name: "Актуальное значение" },
    { id: "wbs-2", code: "S1580", name: "Фундаменты" },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Актуальное значение");
  assert.equal(rows[1].id, "wbs-2");
});

test("узел PLAN-R преобразуется в строку графика и считает недельный прирост", () => {
  const start = "11111111-1111-4111-8111-111111111111";
  const finish = "22222222-2222-4222-8222-222222222222";
  const progress = "33333333-3333-4333-8333-333333333333";
  const rows = mapPlanrSchedule([{
    id: "wbs-1", code: "1.1.1", name: "Фундаменты", type: "task", sortOrder: 1,
    values: { [start]: 1788134400000, [finish]: 1798675200000, [progress]: 55 },
  }], { planStart: start, planFinish: finish, percentDone: progress }, new Map([["wbs-1", 45]]));
  assert.equal(rows[0].name, "Фундаменты");
  assert.equal(rows[0].percentDone, 55);
  assert.equal(rows[0].weekGrowth, 10);
  assert.equal(rows[0].planrWbsId, "wbs-1");
});

test("снимок PLAN-R различает целевые и прогнозные даты", () => {
  const targetStart = "11111111-1111-4111-8111-111111111111";
  const targetFinish = "22222222-2222-4222-8222-222222222222";
  const forecastStart = "33333333-3333-4333-8333-333333333333";
  const forecastFinish = "44444444-4444-4444-8444-444444444444";
  const rows = mapPlanrSnapshot([{
    id: "S1570", parentId: null, code: "S1570", name: "Блок 2", type: "work",
    values: {
      [targetStart]: "2026-01-01", [targetFinish]: "2026-10-01",
      [forecastStart]: "2026-02-01", [forecastFinish]: "2026-12-01",
    },
  }], { targetStart, targetFinish, forecastStart, forecastFinish });
  assert.equal(rows[0].targetFinish, "2026-10-01");
  assert.equal(rows[0].forecastFinish, "2026-12-01");
});

test("снимок PLAN-R читает массив и вложенные значения атрибутов", () => {
  const targetStart = "11111111-1111-4111-8111-111111111111";
  const targetFinish = "22222222-2222-4222-8222-222222222222";
  const rows = mapPlanrSnapshot([{
    id: "S1570", code: "S1570", name: "Блок 2", type: "work",
    values: [
      { wbsAttributeId: targetStart, value: { value: "2026-01-01" } },
      { attributeId: targetFinish, value: "2026-10-01" },
    ],
  }], { targetStart, targetFinish });
  assert.equal(rows[0].targetStart, "2026-01-01");
  assert.equal(rows[0].targetFinish, "2026-10-01");
});

test("снимок PLAN-R наследует текущие даты при пустых целевых датах", () => {
  const targetStart = "11111111-1111-4111-8111-111111111111";
  const targetFinish = "22222222-2222-4222-8222-222222222222";
  const forecastStart = "33333333-3333-4333-8333-333333333333";
  const forecastFinish = "44444444-4444-4444-8444-444444444444";
  const rows = mapPlanrSnapshot([{
    id: "S1570", code: "S1570", name: "Блок 2", type: "work",
    values: {
      [targetStart]: null, [targetFinish]: null,
      [forecastStart]: "2026-01-01", [forecastFinish]: "2026-10-01",
    },
  }], { targetStart, targetFinish, forecastStart, forecastFinish });
  assert.equal(rows[0].targetStart, "2026-01-01");
  assert.equal(rows[0].targetFinish, "2026-10-01");
});
