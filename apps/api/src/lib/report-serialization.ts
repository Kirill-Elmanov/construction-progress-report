/** Преобразует денежные BigInt-поля отчёта в JSON-совместимые числа. */
export function serializeReport(report: any): any {
  if (!report) return report;
  const result = { ...report };
  if (report.budget) {
    result.budget = {
      ...report.budget,
      spentTotal: Number(report.budget.spentTotal),
      paidGp: Number(report.budget.paidGp),
      worksAccepted: Number(report.budget.worksAccepted),
    };
  }
  return result;
}
