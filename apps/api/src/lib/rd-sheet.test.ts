import assert from "node:assert/strict";
import test from "node:test";
import { summarizeRdCsv } from "./rd-sheet.js";

test("реестр РД агрегируется по согласованным статусам", () => {
  const summary = summarizeRdCsv([
    "Шифр комплекта,Наименование раздела,Статус раздела РД,Дата выдачи ФАКТ",
    "А-1,Архитектура,Выдано в производство работ,10.08.2026",
    "КЖ-1,Конструкции,На рассмотрении,11.08.2026",
    "ОВ-1,Отопление,Внести корректировку,12.08.2026",
    "ВК-1,Водоснабжение,В разработке,",
  ].join("\n"));
  assert.deepEqual(summary, {
    volumesTotal: 4, handedToCustomer: 2, onReview: 1,
    issuedVpr: 1, inProgress: 1, withRemarks: 1,
  });
});
