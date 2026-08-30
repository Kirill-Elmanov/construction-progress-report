// ═══════════════════════════════════════════════════════════
// Типы и константы (ТЗ 4.2 ENUM + Развилка 2: латиница в БД,
// русские лейблы на фронте)
// ═══════════════════════════════════════════════════════════

export const ROLES = ['pzgd', 'gip', 'stroycontrol', 'ksp', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  pzgd: 'ПЗГД',
  gip: 'ГИП',
  stroycontrol: 'Стройконтроль',
  ksp: 'Специалист КСП',
  viewer: 'Наблюдатель',
};

export const TRAFFIC_LIGHTS = ['green', 'yellow', 'red'] as const;
export type TrafficLight = (typeof TRAFFIC_LIGHTS)[number];

export const TRAFFIC_LIGHT_EMOJI: Record<TrafficLight, string> = {
  green: '🟢',
  yellow: '🟡',
  red: '🔴',
};

// Светофор проблематики (Г2): лейблы из ТЗ
export const ISSUE_STATUS_LABELS: Record<TrafficLight, string> = {
  red: '🔴 Критично',
  yellow: '🟡 Под контролем',
  green: '🟢 Устранено',
};

export const REPORT_STATUSES = ['draft', 'finalized'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

// Обычное сохранение остаётся черновиком. После фиксации данные версии
// блокируются; корректировка создаёт следующую версию, а не меняет старую.
export function isReportLocked(status: ReportStatus): boolean {
  return status === 'finalized';
}

// Состояние актуальности пригодится локальным разделам и будущим API PLAN-R.
export const DATA_FRESHNESS = ['missing', 'fresh', 'stale'] as const;
export type DataFreshness = (typeof DATA_FRESHNESS)[number];

// ═══ ЭТАП 1: единый справочник разделов отчёта ═══════════════════
// В БД и API храним постоянный латинский key. Буква и название — только
// отображение: их можно исправить, не ломая ранее выданные ссылки-доступы.
export const SECTION_KEYS = [
  'object',
  'budget',
  'rd',
  'worklog',
  'schedule',
  'prescriptions',
  'resources',
  'issues',
  'photos',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export type SectionSource = 'project' | 'report';

export interface SectionDefinition {
  key: SectionKey;
  letter: string;
  title: string;
  source: SectionSource;
}

export const SECTION_DEFINITIONS: readonly SectionDefinition[] = [
  { key: 'object',        letter: 'А', title: 'Информация об объекте',                         source: 'project' },
  { key: 'budget',        letter: 'Б', title: 'Бюджет',                                        source: 'report' },
  { key: 'rd',            letter: 'В', title: 'Разработка РД',                                 source: 'report' },
  { key: 'worklog',       letter: 'Г', title: 'Выполняемые работы за отчётный период',          source: 'report' },
  { key: 'schedule',      letter: 'Д', title: 'График работ за отчётный период',                source: 'project' },
  { key: 'prescriptions', letter: 'Е', title: 'Предписания',                                   source: 'report' },
  { key: 'resources',     letter: 'Ж', title: 'Привлечённые ресурсы',                           source: 'report' },
  { key: 'issues',        letter: 'З', title: 'Проблематика',                                   source: 'report' },
  { key: 'photos',        letter: 'И', title: 'Фотоотчёт',                                      source: 'report' },
];

// Обратная совместимость с данными, созданными до этапа 1.
// В старом интерфейсе последние разделы ошибочно имели буквы З, И, К.
const LEGACY_SECTION_KEYS: Readonly<Record<string, SectionKey>> = {
  А: 'object',
  Б: 'budget',
  В: 'rd',
  Г: 'worklog',
  Д: 'schedule',
  Е: 'prescriptions',
  Ж: 'resources',
  З: 'resources',
  И: 'issues',
  К: 'photos',
};

/** Приводит постоянный key или старую букву раздела к новому формату. */
export function normalizeSectionKey(value: string): SectionKey | null {
  if ((SECTION_KEYS as readonly string[]).includes(value)) {
    return value as SectionKey;
  }
  return LEGACY_SECTION_KEYS[value] ?? null;
}

/** Алиас оставлен для схем валидации. Теперь это именно ключи, а не буквы. */
export const SECTIONS = SECTION_KEYS;

// Дефолтный набор секций по ролям (ТЗ Раздел 2 + решение по КСП).
export const DEFAULT_SECTIONS_BY_ROLE: Record<Role, SectionKey[]> = {
  pzgd: [...SECTION_KEYS],
  gip: ['object', 'budget', 'prescriptions'],
  stroycontrol: ['budget', 'worklog', 'schedule', 'resources', 'issues', 'photos'],
  ksp: ['schedule'], // КСП ведёт резервную таблицу или актуализирует S-кривую PLAN-R
  viewer: [],
};

// TTL токенов (ТЗ 4.6)
export const TTL = {
  DASHBOARD_TOKEN_DAYS: 30, // публичный дашборд
  PDF_LINK_DAYS: 7,         // скачивание PDF (К5)
  // ссылка-доступ для ввода — бессрочная (is_active)
} as const;

// Пороги светофора отставания по умолчанию (A12)
export const DEFAULT_DELAY_THRESHOLDS = { yellow: 5, red: 14 } as const;

// ═══ ПР-2.6 / Т-1: пороги светофора зашиты в код ═══
// 🟢 delay < 7 · 🟡 7 ≤ delay < 14 · 🔴 delay ≥ 14
export const DELAY_THRESHOLDS = { yellow: 7, red: 14 } as const;

// ═══ ПР-6.4 / Т-2: стадии проекта ═══
export const PROJECT_STAGES = [
  'ПИР',
  'ПД',
  'ПД (экспертиза)',
  'РД',
  'Ввод в эксплуатацию',
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

// ═══ ПР-2.4: технические условия ═══
export interface TechCondition {
  kind: string; // «Канализация»
  org: string;  // например, ресурсоснабжающая организация
}
