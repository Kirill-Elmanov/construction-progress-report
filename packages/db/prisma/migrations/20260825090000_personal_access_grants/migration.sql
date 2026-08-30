-- ═══ ЭТАП 2: один персональный токен — несколько проектов ═════════
-- Сам access_link становится учётной записью сотрудника, а права каждого
-- проекта переносятся в отдельную таблицу access_grants.

-- 1. Привязываем персональный токен к тенанту через старый проект.
ALTER TABLE "access_links" ADD COLUMN "tenant_id" UUID;

UPDATE "access_links" AS link
SET "tenant_id" = project."tenant_id",
    "email" = NULLIF(lower(trim(link."email")), '')
FROM "projects" AS project
WHERE project."id" = link."project_id";

ALTER TABLE "access_links" ALTER COLUMN "tenant_id" SET NOT NULL;

-- 2. Создаём назначения на проекты. Для повторяющегося email выбираем
-- самый ранний токен как персональный и объединяем его проектные права.
CREATE TABLE "access_grants" (
  "id" UUID NOT NULL,
  "link_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "allowed_sections" TEXT[] NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "access_grants_pkey" PRIMARY KEY ("id")
);

WITH mapped_links AS (
  SELECT
    link.*,
    CASE
      WHEN link."email" IS NULL THEN link."id"
      ELSE first_value(link."id") OVER (
        PARTITION BY link."tenant_id", link."email"
        ORDER BY link."created_at", link."id"
      )
    END AS canonical_id
  FROM "access_links" AS link
), expanded_sections AS (
  SELECT
    mapped.canonical_id,
    mapped."project_id",
    mapped."is_active",
    mapped."created_at",
    section_key
  FROM mapped_links AS mapped
  CROSS JOIN LATERAL unnest(mapped."allowed_sections") AS section_key
)
INSERT INTO "access_grants" (
  "id", "link_id", "project_id", "allowed_sections",
  "is_active", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  canonical_id,
  "project_id",
  array_agg(DISTINCT section_key),
  bool_or("is_active"),
  min("created_at"),
  CURRENT_TIMESTAMP
FROM expanded_sections
GROUP BY canonical_id, "project_id";

-- 3. Историю правок переводим на выбранный персональный токен.
WITH canonical_links AS (
  SELECT
    link."id" AS old_id,
    first_value(link."id") OVER (
      PARTITION BY link."tenant_id", link."email"
      ORDER BY link."created_at", link."id"
    ) AS canonical_id
  FROM "access_links" AS link
  WHERE link."email" IS NOT NULL
)
UPDATE "section_audit" AS audit
SET "actor_link_id" = canonical.canonical_id
FROM canonical_links AS canonical
WHERE audit."actor_link_id" = canonical.old_id;

-- Канонический токен активен, если активно хотя бы одно старое назначение.
WITH grouped AS (
  SELECT
    "tenant_id",
    "email",
    bool_or("is_active") AS is_active,
    max("last_used_at") AS last_used_at
  FROM "access_links"
  WHERE "email" IS NOT NULL
  GROUP BY "tenant_id", "email"
)
UPDATE "access_links" AS link
SET "is_active" = grouped.is_active,
    "last_used_at" = grouped.last_used_at
FROM grouped
WHERE link."tenant_id" = grouped."tenant_id"
  AND link."email" = grouped."email";

-- Удаляем дубликаты сотрудников, оставляя самый ранний токен.
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "tenant_id", "email"
      ORDER BY "created_at", "id"
    ) AS position
  FROM "access_links"
  WHERE "email" IS NOT NULL
)
DELETE FROM "access_links"
WHERE "id" IN (SELECT "id" FROM ranked WHERE position > 1);

-- 4. Завершаем новую структуру и удаляем старые проектные поля токена.
ALTER TABLE "access_links" DROP CONSTRAINT "access_links_project_id_fkey";
ALTER TABLE "access_links" DROP COLUMN "project_id";
ALTER TABLE "access_links" DROP COLUMN "allowed_sections";

CREATE UNIQUE INDEX "access_links_tenant_id_email_key"
  ON "access_links"("tenant_id", "email");
CREATE INDEX "access_links_tenant_id_idx" ON "access_links"("tenant_id");
CREATE UNIQUE INDEX "access_grants_link_id_project_id_key"
  ON "access_grants"("link_id", "project_id");
CREATE INDEX "access_grants_project_id_idx" ON "access_grants"("project_id");

ALTER TABLE "access_links"
  ADD CONSTRAINT "access_links_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "access_grants"
  ADD CONSTRAINT "access_grants_link_id_fkey"
  FOREIGN KEY ("link_id") REFERENCES "access_links"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "access_grants"
  ADD CONSTRAINT "access_grants_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
