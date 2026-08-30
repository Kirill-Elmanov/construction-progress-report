-- Правки v3: один токен и один набор секций действуют во всех проектах тенанта.
ALTER TABLE "access_links"
ADD COLUMN "allowed_sections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Сохраняем ранее выданные права: объединяем секции всех проектных назначений.
UPDATE "access_links" AS link
SET "allowed_sections" = rights.sections
FROM (
  SELECT grant_row."link_id", ARRAY_AGG(DISTINCT section_key) AS sections
  FROM "access_grants" AS grant_row,
       UNNEST(grant_row."allowed_sections") AS section_key
  WHERE grant_row."is_active" = TRUE
  GROUP BY grant_row."link_id"
) AS rights
WHERE rights."link_id" = link."id";

-- Правки v3: текущий процент готовности хранится в самом разделе работ.
ALTER TABLE "sections"
ADD COLUMN "percent_done" DECIMAL(5, 2) NOT NULL DEFAULT 0;

-- Для существующих разделов переносим последнее введённое значение из отчётов.
UPDATE "sections" AS section_row
SET "percent_done" = latest."percent_done"
FROM (
  SELECT DISTINCT ON (progress."section_id")
    progress."section_id",
    progress."percent_done"
  FROM "section_progress" AS progress
  JOIN "reports" AS report_row ON report_row."id" = progress."report_id"
  ORDER BY progress."section_id", report_row."week_friday" DESC, report_row."version" DESC
) AS latest
WHERE latest."section_id" = section_row."id";
