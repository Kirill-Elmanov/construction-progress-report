import assert from "node:assert/strict";
import test from "node:test";
import { serializeReport } from "./report-serialization.js";

test("денежные BigInt-поля сохранённого отчёта сериализуются в JSON", () => {
  const serialized = serializeReport({
    id: "report-test",
    budget: { spentTotal: 3n, paidGp: 1n, worksAccepted: 2n },
  });

  assert.deepEqual(serialized.budget, {
    spentTotal: 3,
    paidGp: 1,
    worksAccepted: 2,
  });
  assert.doesNotThrow(() => JSON.stringify(serialized));
});
