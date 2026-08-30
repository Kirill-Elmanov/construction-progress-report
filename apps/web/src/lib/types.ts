import {
  normalizeSectionKey,
  SECTION_DEFINITIONS,
  type SectionKey,
  type SectionSource,
} from '@rost/shared/types';

// ─── Роли (ТЗ 4.2) ─────────────────────────────────────────
export type RoleType =
  | 'superadmin'
  | 'pzgd'
  | 'head_of_projects'
  | 'gip'
  | 'gip_deputy'
  | 'coordinator'
  | 'stroycontrol'
  | 'ksp'
  | 'viewer';

export type AccessScope = 'global' | 'project';

export const ROLE_LABELS: Record<RoleType, string> = {
  superadmin: 'Суперадмин',
  pzgd: 'ПЗГД',
  head_of_projects: 'Руководитель проектов',
  gip: 'ГИП',
  gip_deputy: 'Зам ГИПа',
  coordinator: 'Координатор проекта',
  stroycontrol: 'Стройконтроль',
  ksp: 'Специалист КСП',
  viewer: 'Наблюдатель',
};

// ─── Auth (по формату бэка auth.ts) ────────────────────────
export interface LoginUser {
  id: string;
  email: string;
  role: RoleType;
  displayName: string;
  fullName?: string;   // 🆕 ПР-1.3
  mustChangePassword: boolean;
}

export interface LoginResponse {
  token: string;
  user: LoginUser;
}

export interface MeResponse {
  id: string;
  email: string;
  role: RoleType;
  accessScope: AccessScope;
  displayName: string;
  fullName?: string;   // 🆕 ПР-1.3
  tenantId: string;
  mustChangePassword: boolean;
  projectIds: string[];
}

// ─── ПР-2.4: техническое условие ───────────────────────────
export interface TechCondition {
  kind: string;  // «Канализация»
  org: string;   // например, ресурсоснабжающая организация
}

// ─── Проект (Секция А) — ответ GET /projects ───────────────
export interface Project {
  id: string;
  tenantId: string;
  name: string;          // A1
  address: string;       // A2
  customer: string;      // A3 Заказчик
  contractor: string;    // A4 Генподрядчик
  techCustomer: string | null;     // 🆕 ПР-2.1 Технический заказчик
  generalDesigner: string | null;  // 🆕 ПР-2.1 Генеральный проектировщик
  expertiseConclusion: string | null; // 🆕 ПР-2.1
  buildPermit: string | null;         // 🆕 ПР-2.1
  technicalConditions: TechCondition[]; // 🆕 ПР-2.4
  projectStage: string | null;          // 🆕 Т-2 Стадия
  planStart: string;     // A5 ISO
  planFinish: string;    // A6 ISO
  budget: number;        // A7 рубли
  tepArea: number | null;    // ПР-2.3 → отображается как «Площадь ЗУ, м²»
  tepPower: string | null;   // ПР-2.3 → «Площадь возводимых объектов, м²»
  delayYellowDays: number;   // ⚠️ ПР-2.6: больше не используется (пороги в коде)
  delayRedDays: number;      // ⚠️ ПР-2.6: больше не используется
  rdStages: string[];
  rdSheetUrl: string | null;
  planrEpsId: string | null;
  planrAttrMap: {
    code?: string; name?: string; type?: string;
    forecastStart?: string; forecastFinish?: string;
    targetStart?: string; targetFinish?: string;
    percentDone?: string;
  } | null;
  scheduleReportMode: 'manual' | 's_curve';
  deletedAt: string | null;  // 🆕 ПР-1.6 корзина
  createdAt: string;
}

// Роли, которым можно создавать проекты (= GLOBAL_ROLES на бэке)
export const CAN_CREATE_PROJECT: RoleType[] = [
  'superadmin',
  'pzgd',
  'head_of_projects',
];

// ─── Подрядчик (Секция Б / З) ──────────────────────────────
export interface Contractor {
  id: string;
  projectId: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
}

// ─── Раздел работ / «Выполняемые работы» (ПР-4.1, ПР-4.3) ──
export interface Section {
  id: string;
  projectId: string;
  name: string;              // Б1
  code: string | null;       // Б2 — шифр комплекта РД
  sortOrder: number;         // Б3
  contractorId: string | null; // Б4
  planStart: string;         // план начало
  planFinish: string;        // план окончание
  factStart: string | null;  // 🆕 факт начало
  factFinish: string | null; // 🆕 факт окончание
  percentDone?: number;      // 🆕 % из последнего отчёта (только в GET)
  contractor?: { id: string; name: string } | null;
}

// ─── ПР-4.3: График работ за отчётный период ───────────────
export interface ScheduleItem {
  id: string;
  projectId: string;
  code: string;       // «1.1.7.1»
  name: string;
  planStart: string | null;
  planFinish: string | null;
  delayDays: number | null;    // со знаком: +55 / −10
  percentDone: number | null;
  weekGrowth: number | null;
  sortOrder: number;
  level: number;      // глубина вложенности (кол-во точек + 1)
}

// Кто может редактировать карточку проекта (совпадает с PROJECT_EDIT_ROLES на бэке)
export const CAN_EDIT_PROJECT: RoleType[] = [
  'superadmin',
  'pzgd',
  'head_of_projects',
  'gip',
  'gip_deputy',
  'coordinator',
];

// ПР-1.1: кто может удалять отчёты
export const CAN_DELETE_REPORT: RoleType[] = [
  'superadmin', 'pzgd', 'head_of_projects', 'gip', 'gip_deputy', 'coordinator',
];

// ПР-1.6: корзина проектов — только суперадмин
export const CAN_USE_TRASH: RoleType[] = ['superadmin'];

// Правки v3: руководители управляют общими токенами специалистов.
export const CAN_MANAGE_ACCESS: RoleType[] = [
  'superadmin', 'pzgd', 'head_of_projects', 'gip', 'gip_deputy', 'coordinator',
];

// ПР-2.6 / Т-1: пороги светофора зашиты в код
export const DELAY_THRESHOLDS = { yellow: 7, red: 14 } as const;

/** 🟢 delay < 7 · 🟡 7 ≤ delay < 14 · 🔴 delay ≥ 14 */
export function delayLight(delayDays: number): 'green' | 'yellow' | 'red' {
  if (delayDays < DELAY_THRESHOLDS.yellow) return 'green';
  if (delayDays < DELAY_THRESHOLDS.red) return 'yellow';
  return 'red';
}

/** Разница в днях между двумя датами (b − a). null, если чего-то нет. */
export function dayDiff(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * ПР-4.2: отклонение по дате + светофор.
 *  • факт есть → отклонение = факт − план (может быть отрицательным)
 *  • факта нет и план в прошлом → текущая просрочка = сегодня − план
 *  • факта нет и план в будущем → срок ещё не наступил (null)
 */
export function dateDeviation(plan: string | null, fact: string | null) {
  if (!plan) return { days: null as number | null, light: null as null | 'green' | 'yellow' | 'red', pending: false };
  if (fact) {
    const d = dayDiff(plan, fact)!;
    return { days: d, light: delayLight(d), pending: false };
  }
  const today = new Date().toISOString().slice(0, 10);
  const d = dayDiff(plan, today)!;
  if (d <= 0) return { days: null, light: null, pending: true }; // ещё не срок
  return { days: d, light: delayLight(d), pending: true };
}

// ПР-6.4 / Т-2: стадии проекта
export const PROJECT_STAGES = [
  'ПИР', 'ПД', 'ПД (экспертиза)', 'РД', 'Ввод в эксплуатацию',
] as const;

// ─── Отчёты (Секция К) ─────────────────────────────────────
export type ReportStatus = 'draft' | 'finalized';

export interface ReportListItem {
  id: string;
  weekFriday: string;
  status: ReportStatus;
  version: number;
  parentReportId: string | null;
  finalizedAt: string | null;
  createdAt: string;
}

export interface ReportFull extends ReportListItem {
  projectId: string;
}

// ─── Прогресс по разделам (Секция В) ───────────────────────
export interface ProgressRow {
  id: string;
  reportId: string;
  sectionId: string;
  percentDone: number;   // В3
  factStart: string | null;   // В4
  factFinish: string | null;  // В5
  comment: string | null;     // В6
  isCritical: boolean;        // В7
  section: {
    id: string;
    name: string;
    code: string | null;
    sortOrder: number;
    planStart: string;
    planFinish: string;
  };
}

export interface ProgressWarning {
  sectionId: string;
  field: string;
  message: string;
}

// Кто может финализировать отчёт (= GLOBAL_ROLES в reports.ts)
export const CAN_FINALIZE: RoleType[] = ['superadmin', 'pzgd', 'head_of_projects'];

// ─── Секция Г — Проблематика ───────────────────────────────
export type IssueStatus = 'green' | 'yellow' | 'red';

export interface Issue {
  id: string;
  reportId: string;
  parentIssueId: string | null;
  description: string;    // Г1
  status: IssueStatus;    // Г2
  action: string;         // Г3
  responsible: string | null; // Г4
  dueDate: string;        // Г5
  resolvedDate: string | null; // Г6
  isArchived: boolean;
  createdAt: string;
}

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  red: '🔴 Критично',
  yellow: '🟡 Важно',
  green: '🟢 Устранено',
};

// ─── Секция Е — Предписания (ПР-6.2) ───────────────────────
export interface Prescriptions {
  issuedTotal: number;    // Е1
  resolvedTotal: number;  // Е2
  openTotal: number;
  deltas: { issued: number; resolved: number; open: number };
}

// ─── Секция Б — Бюджет (ПР-6.3) ────────────────────────────
export interface BudgetOptionalField {
  id: string;
  label: string;
  value: number | null;
}

export interface BudgetWeekly {
  paidGp: number;         // Б1 Оплачено ГП, ₽
  optionalFields: BudgetOptionalField[]; // Правки v4: Б2…Б11 задаёт сотрудник
  spentTotal: number;     // Правки v4: равно Б1
  projectBudget: number;  // A7
  spentPercent: number;
  projectStage?: string | null;
  deltas: { paidGp: number };
}

// ─── Секция В — Разработка РД (ПР-6.4) ─────────────────────
export interface RdDevelopment {
  volumesTotal: number;     // В1 Всего томов
  handedToCustomer: number; // В2 Передано Тех. Заказчику
  onReview: number;         // В3 На проверке
  issuedVpr: number;        // В4 Выдано ВПР
  inProgress: number;       // В5 В разработке
  withRemarks: number;      // В6 Выданы замечания
  automationConfigured?: boolean;
  deltas: { volumesTotal: number; handedToCustomer: number; issuedVpr: number };
}

// ─── Секция Ж — Ресурсы ────────────────────────────────────
export interface ResourcesWeekly {
  itr: number;        // Ж1
  workers: number;    // Ж2
  machinery: number;  // Ж3
  comment: string | null; // Ж4
  deltas: { itr: number; workers: number; machinery: number };
}

// ─── Секция Г — Выполняемые работы (ПР-6.5) ────────────────
export interface WorkLogItem {
  id: string;
  contractorId: string;
  sectionId: string | null;
  description: string;
  percentDone: number | null;
}

// ─── Секция И — Фотоотчёт ──────────────────────────────────
export interface PhotoItem {
  id: string;
  caption: string | null;   // И2
  sectionId: string | null; // И3
  shotDate: string | null;  // И4 (YYYY-MM-DD)
  sortOrder: number;
  fileUrl: string;   // /api/v1/photos/:id/file
  thumbUrl: string;  // /api/v1/photos/:id/thumb
}

export const PHOTO_MAX_PER_REPORT = 20;
export const PHOTO_MAX_SIZE_MB = 10;

// ─── Дашборд (ТЗ: БЛОКИ 1–5) ───────────────────────────────
export interface DashboardSectionRow {
  id: string;
  name: string;
  code: string | null;
  contractor: string | null;
  percentDone: number;
  weekDelta: number;
  delayDays: number;
  light: 'green' | 'yellow' | 'red';
  isCritical: boolean;
  planStart: string;
  planFinish: string;
  factStart: string | null;
  factFinish: string | null;
}

export interface DashboardData {
  project: {
    id: string; name: string; address: string;
    customer: string; contractor: string; budget: number;
    planStart: string; planFinish: string;
    delayYellowDays: number; delayRedDays: number;
  };
  report: {
    id: string; weekFriday: string; weekNumber: number;
    status: ReportStatus; version: number;
  } | null;
  weeks: { id: string; weekFriday: string; weekNumber: number; status: ReportStatus }[];
  kpi: {
    overallPercent: number; overallDelta: number;
    spentPercent: number; spentDelta: number;
    maxDelayDays: number; delayLight: 'green' | 'yellow' | 'red';
    openIssues: number; redIssues: number; yellowIssues: number;
    prescriptionsOpen: number; prescriptionsIssuedWeek: number;
  } | null;
  sections: DashboardSectionRow[];
  sCurve: { week: string; weekFriday: string; fact: number | null; plan: number | null; forecast?: number | null }[];
  issues: {
    id: string; description: string; status: IssueStatus;
    action: string; responsible: string | null;
    dueDate: string; resolvedDate: string | null;
  }[];
  budget: {
    projectBudget: number; spent: number; spentPercent: number;
    percentDelta: number; spentWeek: number; rdStage: string | null;
  } | null;
  resources: {
    itr: number; workers: number; machinery: number;
    deltas: { itr: number; workers: number; machinery: number };
  } | null;
}

export const LIGHT_EMOJI: Record<'green' | 'yellow' | 'red', string> = {
  green: '🟢', yellow: '🟡', red: '🔴',
};

// ═══ ПР-5.2: порядок и наименования секций отчёта ═══
export interface SectionMeta {
  key: SectionKey;       // постоянный внутренний ключ
  letter: string;        // литера для интерфейса и печатной формы
  title: string;         // название
  source: SectionSource; // откуда данные
}

// Фронтенд не хранит свою копию списка: порядок, буквы и ключи едины для
// формы, прав по токену и будущего PDF-отчёта.
export const REPORT_SECTIONS: SectionMeta[] = SECTION_DEFINITIONS.map((section) => ({
  ...section,
}));

export const ALL_SECTION_KEYS = REPORT_SECTIONS.map((s) => s.key);

/** Метаданные для нового key или старой буквы из сохранённых данных. */
export function getSectionMeta(value: string): SectionMeta | null {
  const key = normalizeSectionKey(value);
  return key ? REPORT_SECTIONS.find((section) => section.key === key) ?? null : null;
}

// ═══ ПР-1.5: ссылки-доступы и аудит ═══════════════════════════

export interface Employee {
  email: string;
  fullName: string;
  position?: string | null;
  role?: string | null;
}

export interface AccessLink {
  id: string; // ID назначения на текущий проект
  personalLinkId: string;
  token: string;
  role: string;
  allowedSections: string[];
  email: string | null;
  fullName: string | null;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  reused?: boolean;
  projects: Array<{ id: string; name?: string }>;
}

export interface AuditEntry {
  actorName: string;
  actorRole: string;
  actorKind: 'user' | 'link';
  at: string;
}

export interface AuditHistoryRow {
  id: string;
  sectionKey: string;
  action: string;
  actorName: string;
  actorRole: string;
  actorKind: 'user' | 'link';
  summary: string | null;
  createdAt: string;
}

/** Кто я: пользователь по паролю или специалист по ссылке */
export interface AccessProjectGrant {
  projectId: string;
  projectName: string;
  allowedSections: string[];
}

export interface WhoAmI {
  kind: 'user' | 'link';
  name: string;
  email: string | null;
  role: string;
  projects: AccessProjectGrant[];
  // Поля совместимости для токенов ровно с одним проектом.
  projectId: string | null;
  allowedSections: string[] | null;
}

/** Редактируемые по ссылке секции. Д временно заполняет КСП до PLAN-R. */
export const GRANTABLE_SECTIONS = REPORT_SECTIONS.filter(
  (s) => s.source === 'report' || s.key === 'schedule',
);

/** Роли, которым можно выдать ссылку-доступ */
export const LINK_ROLES: { value: string; label: string }[] = [
  { value: 'stroycontrol', label: 'Стройконтроль' },
  { value: 'ksp', label: 'КСП' },
  { value: 'coordinator', label: 'Координатор' },
  { value: 'gip', label: 'ГИП' },
  { value: 'gip_deputy', label: 'Зам. ГИПа' },
  { value: 'viewer', label: 'Наблюдатель (только чтение)' },
];
