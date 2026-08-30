import PDFDocument from "pdfkit";
import fs from "node:fs";
import type { ReportSectionSnapshot } from "@prisma/client";
import { SECTION_DEFINITIONS } from "@rost/shared/types";
import { getAbsPath } from "./storage.js";

type Snapshot = Pick<ReportSectionSnapshot, "sectionKey" | "payload">;
type JsonObject = Record<string, any>;

const GREEN = "#00823C";
const DARK = "#28282D";
const MUTED = "#6B7280";
const LINE = "#D1D5DB";
const LIGHT = "#F3F4F6";
const AMBER = "#D97706";
const RED = "#DC2626";

/** Подбирает кириллический шрифт для Windows-разработки и Linux-контейнера. */
function findFont(bold = false) {
  const candidates = bold
    ? ["C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
    : ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"];
  return candidates.find((file) => fs.existsSync(file));
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function textValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.length ? value.map(textValue).join(", ") : "-";
  if (typeof value === "object") return Object.values(value as JsonObject).map(textValue).join("; ");
  if (typeof value === "number") return new Intl.NumberFormat("ru-RU").format(value);
  return String(value);
}

function formatDate(value: Date | string) {
  return new Date(value).toLocaleDateString("ru-RU", { timeZone: "UTC" });
}

/** Приводит даты из полей формы к единому виду отчёта. */
function formatOptionalDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)
    ? formatDate(value)
    : textValue(value);
}

/** Создаёт PDF в памяти; источник — только снимки финализированного отчёта. */
export async function createReportPdf(input: {
  reportId: string;
  projectName: string;
  weekFriday: Date;
  version: number;
  finalizedAt: Date | null;
  snapshots: Snapshot[];
}) {
  const regular = findFont(false);
  const bold = findFont(true);
  if (!regular || !bold) throw new Error("Не найден шрифт с поддержкой кириллицы");

  const doc = new PDFDocument({
    size: "A4", layout: "landscape", margin: 34, bufferPages: true,
    info: { Title: `Отчёт ${input.projectName}`, Author: "РОСТ-Отчёт" },
  });
  doc.registerFont("Rost", regular);
  doc.registerFont("RostBold", bold);
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // Правки v6: на титульном листе остаётся только содержание отчёта без маркировки приложения.
  doc.font("RostBold").moveDown(1.7).fillColor(DARK).fontSize(24).text("Отчёт о ходе строительства", { align: "center" });
  doc.moveDown(0.6).fontSize(16).text(input.projectName, { align: "center" });
  doc.moveDown(1.5).font("Rost").fontSize(12).fillColor(MUTED)
    .text(`Отчётная дата: ${formatDate(input.weekFriday)}`, { align: "center" })
    .text(`Версия: ${input.version}`, { align: "center" })
    .text(`Сформирован: ${input.finalizedAt ? formatDate(input.finalizedAt) : "-"}`, { align: "center" });
  doc.moveDown(2).strokeColor(GREEN).lineWidth(3).moveTo(150, doc.y).lineTo(692, doc.y).stroke();

  // Разделы всегда идут в порядке А–И, независимо от времени записи снимков в БД.
  const orderedSnapshots = [...input.snapshots].sort((left, right) => {
    const leftIndex = SECTION_DEFINITIONS.findIndex((item) => item.key === left.sectionKey);
    const rightIndex = SECTION_DEFINITIONS.findIndex((item) => item.key === right.sectionKey);
    return leftIndex - rightIndex;
  });

  // Правки v5: после обложки идёт управленческая сводка. Она собирает
  // ключевые показатели из тех же неизменяемых снимков, что и весь PDF.
  doc.addPage();
  sectionTitle(doc, "Сводка руководителя");
  renderExecutiveSummary(doc, orderedSnapshots, input.weekFriday);

  for (const snapshot of orderedSnapshots) {
    doc.addPage();
    const definition = SECTION_DEFINITIONS.find((item) => item.key === snapshot.sectionKey);
    sectionTitle(doc, `${definition?.letter ?? ""} — ${definition?.title ?? snapshot.sectionKey}`);
    renderSection(doc, snapshot.sectionKey, object(snapshot.payload), input.weekFriday);
  }

  // Колонтитулы добавляются после содержимого, чтобы заранее знать общее число страниц.
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index);
    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const footerY = doc.page.height - 24;
    doc.strokeColor(GREEN).lineWidth(2).moveTo(34, footerY - 8).lineTo(doc.page.width - 34, footerY - 8).stroke();
    doc.font("Rost").fontSize(8).fillColor(MUTED)
      .text(input.projectName, 34, footerY, { width: doc.page.width - 220, lineBreak: false, ellipsis: true })
      .text(`Страница ${index + 1} из ${range.count}`, doc.page.width - 150, footerY, { width: 116, align: "right", lineBreak: false });
    doc.page.margins.bottom = originalBottomMargin;
  }
  doc.end();
  return completed;
}

function snapshotPayload(snapshots: Snapshot[], key: string) {
  return object(snapshots.find((item) => item.sectionKey === key)?.payload);
}

/** Компактная первая страница: прогресс, бюджет, риски и ресурсы. */
function renderExecutiveSummary(doc: PDFKit.PDFDocument, snapshots: Snapshot[], reportDate: Date) {
  const schedule = snapshotPayload(snapshots, "schedule");
  const budget = object(snapshotPayload(snapshots, "budget").budget ?? snapshotPayload(snapshots, "budget"));
  const issues = snapshotPayload(snapshots, "issues").issues;
  const prescriptions = object(snapshotPayload(snapshots, "prescriptions").prescriptions ?? snapshotPayload(snapshots, "prescriptions"));
  const resources = object(snapshotPayload(snapshots, "resources").resources ?? snapshotPayload(snapshots, "resources"));
  const scheduleRows = Array.isArray(schedule.items) ? schedule.items : [];
  const issueRows = Array.isArray(issues) ? issues : [];
  const curveRows = Array.isArray(schedule.points) ? schedule.points : [];
  const progressValues = (schedule.mode === "s_curve" ? curveRows.map((row) => row?.fact) : scheduleRows.map((row) => row?.percentDone))
    .flatMap((raw) => raw === null || raw === undefined || raw === "" ? [] : [Number(raw)])
    .filter((value) => Number.isFinite(value));
  const progress = progressValues.length
    ? schedule.mode === "s_curve"
      ? Math.round(progressValues[progressValues.length - 1])
      : Math.round(progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length)
    : 0;
  const projectBudget = Number(budget.projectBudget ?? 0);
  const paid = Number(budget.paidGp ?? 0);
  const budgetPercent = projectBudget > 0 ? Math.round((paid / projectBudget) * 1000) / 10 : 0;
  const redIssues = issueRows.filter((row) => row?.status === "red").length;
  const openIssues = issueRows.filter((row) => row?.status !== "green").length;
  const prescriptionsOpen = Math.max(0, Number(prescriptions.issuedTotal ?? 0) - Number(prescriptions.resolvedTotal ?? 0));
  const resourcesTotal = Number(resources.itr ?? 0) + Number(resources.workers ?? 0) + Number(resources.machinery ?? 0);

  const cards = [
    ["Общий прогресс", `${progress}%`, `на ${formatDate(reportDate)}`, GREEN],
    ["Освоение бюджета", `${budgetPercent}%`, `${textValue(paid)} ₽ оплачено`, GREEN],
    ["Открытые проблемы", String(openIssues), redIssues ? `критичных: ${redIssues}` : "критичных нет", redIssues ? RED : GREEN],
    ["Открытые предписания", String(prescriptionsOpen), "требуют контроля", prescriptionsOpen ? AMBER : GREEN],
  ] as const;
  const cardWidth = 180;
  cards.forEach((card, index) => drawKpiCard(
    doc, 34 + index * 190, 92, cardWidth, 90,
    card[0], card[1], card[2], card[3],
  ));

  doc.font("RostBold").fontSize(12).fillColor(DARK).text("Ключевые индикаторы", 34, 208);
  drawMetricBar(doc, 34, 236, 350, "Физическая готовность", progress, GREEN);
  drawMetricBar(doc, 34, 286, 350, "Освоение бюджета", budgetPercent, GREEN);

  doc.roundedRect(420, 220, 352, 130, 10).fill(LIGHT);
  doc.font("RostBold").fontSize(11).fillColor(DARK).text("Ресурсы на площадке", 440, 238);
  const resourceRows: Array<[string, number]> = [
    ["ИТР", Number(resources.itr ?? 0)],
    ["Рабочие", Number(resources.workers ?? 0)],
    ["Техника", Number(resources.machinery ?? 0)],
  ];
  resourceRows.forEach(([label, value], index) => {
    const x = 440 + index * 105;
    doc.font("RostBold").fontSize(20).fillColor(GREEN).text(String(value), x, 270, { width: 90, align: "center" });
    doc.font("Rost").fontSize(8).fillColor(MUTED).text(label, x, 300, { width: 90, align: "center" });
  });
  doc.font("Rost").fontSize(8).fillColor(MUTED).text(`Всего единиц: ${resourcesTotal}`, 440, 326);

  doc.font("RostBold").fontSize(12).fillColor(DARK).text("Фокус руководителя", 34, 382);
  const focus = [
    redIssues ? `Критические проблемы: ${redIssues}` : "Критических проблем нет",
    prescriptionsOpen ? `Открытые предписания: ${prescriptionsOpen}` : "Все предписания устранены",
    budgetPercent > 100 ? "Оплата превысила бюджет проекта" : `Остаток бюджета: ${Math.max(0, 100 - budgetPercent).toFixed(1)}%`,
  ];
  focus.forEach((line, index) => {
    const color = index === 0 && redIssues ? RED : index === 1 && prescriptionsOpen ? AMBER : GREEN;
    doc.circle(43, 418 + index * 34, 4).fill(color);
    doc.font("Rost").fontSize(10).fillColor(DARK).text(line, 56, 411 + index * 34, { width: 700 });
  });
  doc.y = 520;
}

function drawKpiCard(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  value: string,
  note: string,
  color: string,
) {
  doc.roundedRect(x, y, width, height, 10).fill(LIGHT);
  doc.font("Rost").fontSize(8).fillColor(MUTED).text(label, x + 12, y + 12, { width: width - 24 });
  doc.font("RostBold").fontSize(22).fillColor(color).text(value, x + 12, y + 31, { width: width - 24 });
  doc.font("Rost").fontSize(8).fillColor(MUTED).text(note, x + 12, y + 67, { width: width - 24 });
}

function drawMetricBar(doc: PDFKit.PDFDocument, x: number, y: number, width: number, label: string, value: number, color: string) {
  const safeValue = Math.max(0, Math.min(100, value));
  doc.font("Rost").fontSize(9).fillColor(DARK).text(label, x, y, { width: width - 50 });
  doc.font("RostBold").fontSize(9).fillColor(color).text(`${value}%`, x + width - 50, y, { width: 50, align: "right" });
  doc.roundedRect(x, y + 20, width, 10, 5).fill("#E5E7EB");
  if (safeValue > 0) doc.roundedRect(x, y + 20, width * safeValue / 100, 10, 5).fill(color);
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string) {
  doc.font("RostBold").fontSize(18).fillColor(DARK).text(title);
  doc.moveDown(0.4).strokeColor(GREEN).lineWidth(2).moveTo(34, doc.y).lineTo(doc.page.width - 34, doc.y).stroke();
  doc.moveDown(0.8);
}

function ensureSpace(doc: PDFKit.PDFDocument, height: number) {
  if (doc.y + height > doc.page.height - 55) doc.addPage();
}

function renderSection(doc: PDFKit.PDFDocument, key: string, payload: JsonObject, reportDate: Date) {
  if (payload.empty) { doc.font("Rost").fontSize(11).fillColor(MUTED).text("Раздел не заполнен."); return; }
  if (key === "object") return renderObject(doc, payload);
  if (key === "schedule") {
    return payload.mode === "s_curve"
      ? renderSCurve(doc, payload.points ?? [], String(payload.scopeName ?? "Весь объект"), reportDate)
      : renderSchedule(doc, payload.items ?? [], reportDate);
  }
  if (key === "issues") return renderIssues(doc, payload.issues ?? []);
  if (key === "worklog") return renderWorklog(doc, payload);
  if (key === "photos") return renderPhotos(doc, payload.photos ?? []);
  if (key === "budget") return renderBudget(doc, object(payload.budget ?? payload));
  if (key === "rd") return renderRdDevelopment(doc, object(payload.rdDevelopment ?? payload));
  if (key === "prescriptions") return renderPrescriptions(doc, object(payload.prescriptions ?? payload));
  if (key === "resources") return renderResources(doc, object(payload.resources ?? payload));

  const block = payload.budget ?? payload.rdDevelopment ?? payload.prescriptions ?? payload.resources ?? payload;
  renderPairs(doc, block);
}

function renderRdDevelopment(doc: PDFKit.PDFDocument, data: JsonObject) {
  const rows: Array<[string, number]> = [
    ["Передано заказчику", Number(data.handedToCustomer ?? 0)],
    ["На проверке", Number(data.onReview ?? 0)],
    ["Выдано ВПР", Number(data.issuedVpr ?? 0)],
    ["В разработке", Number(data.inProgress ?? 0)],
    ["С замечаниями", Number(data.withRemarks ?? 0)],
  ];
  const total = Math.max(1, Number(data.volumesTotal ?? 0), ...rows.map((row) => row[1]));
  doc.font("RostBold").fontSize(28).fillColor(GREEN).text(textValue(data.volumesTotal ?? 0), 34, 112);
  doc.font("Rost").fontSize(9).fillColor(MUTED).text("томов РД всего", 34, 150);
  rows.forEach(([label, value], index) => {
    const y = 112 + index * 58;
    doc.font("Rost").fontSize(9).fillColor(DARK).text(label, 210, y, { width: 180 });
    doc.roundedRect(400, y + 2, 310, 12, 6).fill("#E5E7EB");
    if (value > 0) doc.roundedRect(400, y + 2, 310 * Math.min(value / total, 1), 12, 6).fill(GREEN);
    doc.font("RostBold").fontSize(9).fillColor(DARK).text(String(value), 724, y, { width: 50, align: "right" });
  });
  doc.y = 420;
}

function renderPrescriptions(doc: PDFKit.PDFDocument, data: JsonObject) {
  const issued = Number(data.issuedTotal ?? 0);
  const resolved = Number(data.resolvedTotal ?? 0);
  const open = Math.max(0, issued - resolved);
  const resolvedPercent = issued > 0 ? Math.round((resolved / issued) * 1000) / 10 : 0;
  drawDonut(doc, 175, 245, 82, resolvedPercent, "Устранено");
  renderPairRows(doc, [
    ["Выдано всего", issued],
    ["Устранено всего", resolved],
    ["Открыто", open],
  ], 320, 145, 420, 1);
  doc.y = 370;
}

function renderResources(doc: PDFKit.PDFDocument, data: JsonObject) {
  const rows: Array<[string, number]> = [
    ["ИТР", Number(data.itr ?? 0)],
    ["Рабочие", Number(data.workers ?? 0)],
    ["Техника", Number(data.machinery ?? 0)],
  ];
  const max = Math.max(1, ...rows.map((row) => row[1]));
  rows.forEach(([label, value], index) => {
    const x = 90 + index * 240;
    const height = 230 * value / max;
    doc.roundedRect(x, 385 - height, 120, height || 2, 8).fill(index === 1 ? GREEN : "#5AAE78");
    doc.font("RostBold").fontSize(22).fillColor(DARK).text(String(value), x, 400, { width: 120, align: "center" });
    doc.font("Rost").fontSize(10).fillColor(MUTED).text(label, x, 434, { width: 120, align: "center" });
  });
  if (data.comment) {
    doc.roundedRect(90, 485, 600, 46, 8).fill(LIGHT);
    doc.font("Rost").fontSize(9).fillColor(DARK).text(String(data.comment), 104, 500, { width: 572 });
  }
  doc.y = 540;
}

/** Правки v4: бюджет печатается как обязательное Б1 и заполненные доп. строки. */
function renderBudget(doc: PDFKit.PDFDocument, data: JsonObject) {
  const rows: Array<[string, unknown]> = [
    ["Стоимость по договору ГП, ₽", data.projectBudget],
    ["Оплачено ГП, ₽", data.paidGp],
  ];
  const optionalFields = Array.isArray(data.optionalFields) ? data.optionalFields : [];
  for (const field of optionalFields) {
    if (!field || typeof field !== "object") continue;
    const label = String(field.label ?? "").trim();
    if (!label || field.value === null || field.value === undefined || field.value === "") continue;
    rows.push([`${label}, ₽`, field.value]);
  }
  const budget = Number(data.projectBudget ?? 0);
  const paid = Number(data.paidGp ?? 0);
  const percent = budget > 0 ? Math.round((paid / budget) * 1000) / 10 : 0;
  drawDonut(doc, 155, 240, 82, percent, "Оплачено");
  doc.font("RostBold").fontSize(12).fillColor(DARK).text("Структура бюджета", 286, 115);
  renderPairRows(doc, rows, 286, 148, 480, 1);
  doc.y = Math.max(doc.y, 360);
}

/** Круговая диаграмма без внешней графической библиотеки. */
function drawDonut(doc: PDFKit.PDFDocument, cx: number, cy: number, radius: number, percent: number, label: string) {
  const safePercent = Math.max(0, Math.min(100, percent));
  const segments = 100;
  doc.lineWidth(14).lineCap("butt");
  for (let index = 0; index < segments; index++) {
    const start = (-90 + index * 360 / segments) * Math.PI / 180;
    const end = (-90 + (index + 0.82) * 360 / segments) * Math.PI / 180;
    doc.strokeColor(index < safePercent ? GREEN : "#E5E7EB")
      .moveTo(cx + Math.cos(start) * radius, cy + Math.sin(start) * radius)
      .lineTo(cx + Math.cos(end) * radius, cy + Math.sin(end) * radius)
      .stroke();
  }
  doc.lineCap("butt").font("RostBold").fontSize(25).fillColor(GREEN)
    .text(`${percent}%`, cx - 55, cy - 17, { width: 110, align: "center" });
  doc.font("Rost").fontSize(9).fillColor(MUTED)
    .text(label, cx - 55, cy + 17, { width: 110, align: "center" });
}

function renderObject(doc: PDFKit.PDFDocument, data: JsonObject) {
  const rows: Array<[string, unknown]> = [
    ["Наименование", data.name], ["Адрес", data.address], ["Заказчик", data.customer],
    ["Технический заказчик", data.techCustomer], ["Генподрядчик", data.contractor],
    ["Генеральный проектировщик", data.generalDesigner], ["Начало", formatOptionalDate(data.planStart)],
    ["Завершение", formatOptionalDate(data.planFinish)], ["Бюджет, ₽", data.budget],
    ["Стадия проекта", data.projectStage], ["Разрешение на строительство", data.buildPermit],
  ];
  renderPairs(doc, Object.fromEntries(rows));
}

function renderPairs(doc: PDFKit.PDFDocument, data: JsonObject) {
  const labels: Record<string, string> = {
    paidGp: "Оплачено ГП, ₽", worksAccepted: "Принято работ, ₽", comment: "Комментарий",
    volumesTotal: "Всего томов", handedToCustomer: "Передано Техническому заказчику",
    onReview: "На проверке", issuedVpr: "Выдано ВПР", inProgress: "В разработке",
    withRemarks: "С замечаниями", issuedTotal: "Выдано", resolvedTotal: "Устранено",
    itr: "ИТР", workers: "Рабочие", machinery: "Техника",
  };
  renderPairRows(doc, Object.entries(data).map(([key, value]) => [labels[key] ?? key, value]));
}

/** Карточки в две колонки лучше используют широкую страницу, чем прежний список. */
function renderPairRows(
  doc: PDFKit.PDFDocument,
  rows: Array<[string, unknown]>,
  startX = 34,
  startY = doc.y,
  totalWidth = doc.page.width - 68,
  columns = 2,
) {
  const gap = 12;
  const width = (totalWidth - gap * (columns - 1)) / columns;
  let y = startY;
  for (let index = 0; index < rows.length; index += columns) {
    const group = rows.slice(index, index + columns);
    const cardHeight = Math.max(46, ...group.map(([label, value]) => {
      const labelHeight = doc.font("Rost").fontSize(8).heightOfString(label, { width: width - 24 });
      const valueHeight = doc.font("RostBold").fontSize(11).heightOfString(textValue(value), { width: width - 24 });
      return 18 + labelHeight + valueHeight + 10;
    }));
    if (y + cardHeight > doc.page.height - 55) {
      doc.addPage();
      y = 42;
    }
    group.forEach(([label, value], column) => {
      const x = startX + column * (width + gap);
      doc.roundedRect(x, y, width, cardHeight, 7).fill(LIGHT);
      doc.font("Rost").fontSize(8).fillColor(MUTED).text(label, x + 12, y + 8, { width: width - 24 });
      doc.font("RostBold").fontSize(11).fillColor(DARK).text(textValue(value), x + 12, y + 23, { width: width - 24 });
    });
    y += cardHeight + 8;
  }
  doc.y = y;
}

function renderSchedule(doc: PDFKit.PDFDocument, rows: JsonObject[], reportDate: Date) {
  const widths = [55, 285, 75, 75, 70, 90, 80];
  const headers = ["№", "Наименование работ", "Начало", "Завершение", "Отставание, дни", `Выполнение на ${formatDate(reportDate)}, %`, "Прирост за неделю, %"];
  renderTable(doc, headers, rows.map((row) => [
    row.code, row.name, formatOptionalDate(row.planStart), formatOptionalDate(row.planFinish),
    row.delayDays, row.percentDone, row.weekGrowth,
  ]), widths, rows.map((row) => String(row.code).split(".").length <= 2));
}

/** Векторная S-кривая в PDF: качество не зависит от масштаба или браузера. */
function renderSCurve(doc: PDFKit.PDFDocument, rows: JsonObject[], scopeName: string, reportDate: Date) {
  const points = rows.filter((row) => row && typeof row === "object");
  if (!points.length) {
    doc.font("Rost").fontSize(10).fillColor(MUTED).text("Данные PLAN-R ещё не актуализированы.");
    return;
  }
  doc.font("RostBold").fontSize(12).fillColor(DARK).text(scopeName);
  doc.font("Rost").fontSize(9).fillColor(MUTED).text(`Состояние на ${formatDate(reportDate)}`);
  const x = 70; const y = 135; const width = 680; const height = 330;
  doc.strokeColor("#D1D5DB").lineWidth(1).moveTo(x, y).lineTo(x, y + height).lineTo(x + width, y + height).stroke();
  for (let percent = 0; percent <= 100; percent += 25) {
    const py = y + height - height * percent / 100;
    doc.strokeColor("#E5E7EB").dash(3, { space: 3 }).moveTo(x, py).lineTo(x + width, py).stroke().undash();
    doc.font("Rost").fontSize(8).fillColor(MUTED).text(`${percent}%`, 34, py - 4, { width: 32, align: "right" });
  }
  const px = (index: number) => x + (points.length <= 1 ? 0 : width * index / (points.length - 1));
  const py = (value: number) => y + height - height * Math.max(0, Math.min(100, value)) / 100;
  const drawSeries = (key: string, color: string, dashed = false) => {
    let started = false;
    doc.strokeColor(color).lineWidth(key === "fact" ? 3 : 2);
    if (dashed) doc.dash(7, { space: 5 });
    points.forEach((point, index) => {
      const raw = point[key];
      if (raw === null || raw === undefined || raw === "") return;
      const value = Number(raw);
      if (!Number.isFinite(value)) return;
      if (!started) { doc.moveTo(px(index), py(value)); started = true; }
      else doc.lineTo(px(index), py(value));
    });
    if (started) doc.stroke();
    if (dashed) doc.undash();
  };
  drawSeries("plan", "#9CA3AF");
  drawSeries("fact", GREEN);
  drawSeries("forecast", GREEN, true);
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  labelIndexes.forEach((index) => {
    doc.font("Rost").fontSize(8).fillColor(MUTED).text(String(points[index]?.label ?? ""), px(index) - 36, y + height + 8, { width: 72, align: "center" });
  });
  const legendY = y + height + 42;
  [["План", "#9CA3AF", false], ["Факт", GREEN, false], ["Прогноз", GREEN, true]].forEach((entry, index) => {
    const lx = 245 + index * 125;
    doc.strokeColor(entry[1] as string).lineWidth(2);
    if (entry[2]) doc.dash(6, { space: 4 });
    doc.moveTo(lx, legendY + 4).lineTo(lx + 26, legendY + 4).stroke().undash();
    doc.font("Rost").fontSize(9).fillColor(DARK).text(entry[0] as string, lx + 34, legendY, { width: 80 });
  });
  doc.y = legendY + 35;
}

function renderIssues(doc: PDFKit.PDFDocument, rows: JsonObject[]) {
  const statuses: Record<string, string> = {
    red: "Критично", yellow: "Под контролем", green: "Устранено",
  };
  renderTable(doc, ["Проблема", "Статус", "Мероприятия", "Ответственный", "Срок", "Устранено"],
    rows.map((row) => [
      row.description,
      statuses[String(row.status)] ?? row.status,
      row.action,
      row.responsible,
      formatOptionalDate(row.dueDate),
      formatOptionalDate(row.resolvedDate),
    ]), [190, 78, 205, 100, 72, 75]);
}

function renderWorklog(doc: PDFKit.PDFDocument, payload: JsonObject) {
  const rows = payload.worklog ?? [];
  renderTable(doc, ["Подрядчик", "Раздел", "Выполненные работы", "Выполнение, %"],
    rows.map((row: JsonObject) => [
      row.contractorName ?? row.contractorId,
      row.sectionName ?? row.sectionId,
      row.description,
      row.percentDone,
    ]), [150, 150, 360, 90]);
}

function renderTable(doc: PDFKit.PDFDocument, headers: string[], rows: unknown[][], widths: number[], groups: boolean[] = []) {
  /** Рисует строку и возвращает её высоту для контроля переноса страницы. */
  const drawRow = (values: unknown[], fill: string, bold = false, allowPageBreak = true) => {
    const texts = values.map(textValue);
    const height = Math.max(24, ...texts.map((text, index) => doc.heightOfString(text, { width: widths[index] - 10 }) + 10));
    if (allowPageBreak && doc.y + height + 2 > doc.page.height - 55) {
      doc.addPage();
      drawRow(headers, "#E5E7EB", true, false);
    }
    let x = 34; const y = doc.y;
    texts.forEach((text, index) => {
      doc.rect(x, y, widths[index], height).fillAndStroke(fill, LINE);
      doc.font(bold ? "RostBold" : "Rost").fontSize(8).fillColor(DARK).text(text, x + 5, y + 5, { width: widths[index] - 10, height: height - 8, align: index === 1 ? "left" : "center" });
      x += widths[index];
    });
    doc.y = y + height;
    return height;
  };
  drawRow(headers, "#E5E7EB", true);
  rows.forEach((row, index) => drawRow(row, groups[index] ? "#EEE3DF" : "#FFFFFF", groups[index]));
  if (!rows.length) doc.font("Rost").fontSize(10).fillColor(MUTED).text("Нет данных");
}

/** Читаемые реквизиты фотографии для PDF и регрессионных тестов. */
export function photoCaptionLines(photo: JsonObject, index: number): string[] {
  const sectionName = typeof photo.sectionName === "string" ? photo.sectionName.trim() : "";
  const legacyCaption = typeof photo.caption === "string" ? photo.caption.trim() : "";
  const lines = [sectionName || legacyCaption || `Фото ${index + 1}`];
  if (photo.shotDate) lines.push(`Дата съёмки: ${formatOptionalDate(photo.shotDate)}`);
  return lines;
}

function renderPhotos(doc: PDFKit.PDFDocument, photos: JsonObject[]) {
  if (!photos.length) { doc.font("Rost").fillColor(MUTED).text("Нет фотографий"); return; }
  for (let index = 0; index < photos.length; index += 2) {
    ensureSpace(doc, 240);
    const pair = photos.slice(index, index + 2);
    const y = doc.y;
    let rowBottom = y + 215;
    pair.forEach((photo, offset) => {
      const x = 34 + offset * 380;
      const key = photo.thumbKey ?? photo.storageKey;
      const file = key ? getAbsPath(key) : null;
      if (file && fs.existsSync(file)) doc.image(file, x, y, { fit: [350, 175], align: "center", valign: "center" });
      else doc.rect(x, y, 350, 175).fill("#F3F4F6").font("Rost").fontSize(9).fillColor(MUTED).text("Изображение недоступно", x, y + 80, { width: 350, align: "center" });
      const [title, dateLine] = photoCaptionLines(photo, index + offset);
      const titleY = y + 180;
      doc.font("RostBold").fontSize(8).fillColor(DARK)
        .text(title, x, titleY, { width: 350, align: "center" });
      let captionBottom = titleY + doc.heightOfString(title, { width: 350 });
      if (dateLine) {
        captionBottom += 2;
        doc.font("Rost").fontSize(7.5).fillColor(MUTED)
          .text(dateLine, x, captionBottom, { width: 350, align: "center" });
        captionBottom += doc.heightOfString(dateLine, { width: 350 });
      }
      rowBottom = Math.max(rowBottom, captionBottom + 8);
    });
    doc.y = rowBottom;
  }
}
