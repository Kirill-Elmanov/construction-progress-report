import assert from "node:assert/strict";
import test from "node:test";
import { createReportPdf, photoCaptionLines } from "./report-pdf.js";

// ===================================================================
// PDF: защита от пустых страниц при добавлении нижних колонтитулов
// ===================================================================
test("PDF содержит обложку, сводку и по одной странице на каждый раздел", async () => {
  const pdf = await createReportPdf({
    reportId: "report-test",
    projectName: "Тестовый тепличный комбинат",
    weekFriday: new Date("2026-06-19T00:00:00.000Z"),
    version: 1,
    finalizedAt: new Date("2026-06-19T12:00:00.000Z"),
    snapshots: [
      { sectionKey: "object", payload: { name: "Объект", planStart: "2025-09-22" } },
      {
        sectionKey: "budget",
        payload: {
          budget: {
            projectBudget: 10_000_000,
            paidGp: 5_000_000,
            optionalFields: [
              { label: "Принято работ", value: 1_000_000 },
              { label: "Пустой показатель", value: null },
            ],
          },
        },
      },
      { sectionKey: "schedule", payload: { items: [] } },
    ],
  });

  const source = pdf.toString("latin1");
  assert.equal(source.startsWith("%PDF-"), true);
  assert.equal(source.match(/\/Type\s*\/Page\b/g)?.length, 5);
});

test("PDF формирует секцию Д как S-кривую", async () => {
  const pdf = await createReportPdf({
    reportId: "curve-test", projectName: "Тестовый объект",
    weekFriday: new Date("2026-08-28T00:00:00.000Z"), version: 1,
    finalizedAt: new Date("2026-08-28T12:00:00.000Z"),
    snapshots: [{
      sectionKey: "schedule",
      payload: {
        mode: "s_curve", scopeName: "Весь объект",
        points: [
          { label: "01.01.26", plan: 0, fact: 0, forecast: null },
          { label: "28.08.26", plan: 60, fact: 44, forecast: 44 },
          { label: "01.12.26", plan: 100, fact: null, forecast: 100 },
        ],
      },
    }],
  });
  assert.equal(pdf.toString("latin1").startsWith("%PDF-"), true);
});

test("PDF подписывает фото выбранным разделом и датой съёмки", () => {
  assert.deepEqual(photoCaptionLines({
    sectionName: "Разгрузка материалов, перевозка материалов",
    shotDate: "2026-08-21",
  }, 0), [
    "Разгрузка материалов, перевозка материалов",
    "Дата съёмки: 21.08.2026",
  ]);
  assert.deepEqual(photoCaptionLines({}, 1), ["Фото 2"]);
});
