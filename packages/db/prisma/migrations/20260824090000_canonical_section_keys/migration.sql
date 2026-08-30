-- ═══ ЭТАП 1: постоянные внутренние ключи разделов ════════════════
-- Раньше права и состав отчёта хранили русские литеры. Последние три
-- раздела в старом интерфейсе были ошибочно обозначены З, И, К.

-- Ссылки-доступы: {Б, З, К} -> {budget, resources, photos}.
UPDATE "access_links"
SET "allowed_sections" = ARRAY(
  SELECT DISTINCT CASE old_key
    WHEN 'А' THEN 'object'
    WHEN 'Б' THEN 'budget'
    WHEN 'В' THEN 'rd'
    WHEN 'Г' THEN 'worklog'
    WHEN 'Д' THEN 'schedule'
    WHEN 'Е' THEN 'prescriptions'
    WHEN 'Ж' THEN 'resources'
    WHEN 'З' THEN 'resources'
    WHEN 'И' THEN 'issues'
    WHEN 'К' THEN 'photos'
    ELSE old_key
  END
  FROM unnest("allowed_sections") AS old_key
);

-- Аудит: новые записи используют те же ключи, что API и права доступа.
UPDATE "section_audit"
SET "section_key" = CASE "section_key"
  WHEN 'А' THEN 'object'
  WHEN 'Б' THEN 'budget'
  WHEN 'В' THEN 'rd'
  WHEN 'Г' THEN 'worklog'
  WHEN 'Д' THEN 'schedule'
  WHEN 'Е' THEN 'prescriptions'
  WHEN 'Ж' THEN 'resources'
  WHEN 'З' THEN 'resources'
  WHEN 'И' THEN 'issues'
  WHEN 'К' THEN 'photos'
  WHEN '—' THEN 'report'
  ELSE "section_key"
END;

-- Выбранный состав ранее созданных отчётов хранится в JSON-массиве.
UPDATE "reports"
SET "enabled_sections" = COALESCE((
  SELECT jsonb_agg(DISTINCT
    CASE old_key
      WHEN 'А' THEN 'object'
      WHEN 'Б' THEN 'budget'
      WHEN 'В' THEN 'rd'
      WHEN 'Г' THEN 'worklog'
      WHEN 'Д' THEN 'schedule'
      WHEN 'Е' THEN 'prescriptions'
      WHEN 'Ж' THEN 'resources'
      WHEN 'З' THEN 'resources'
      WHEN 'И' THEN 'issues'
      WHEN 'К' THEN 'photos'
      ELSE old_key
    END
  )
  FROM jsonb_array_elements_text("enabled_sections") AS old_key
), '[]'::jsonb)
WHERE "enabled_sections" IS NOT NULL
  AND jsonb_typeof("enabled_sections") = 'array';
