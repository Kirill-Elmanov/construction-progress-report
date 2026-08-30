-- Правки v6: раньше authGuard автоматически открывал токену все проекты арендатора.
-- Перед переходом к явным переключателям сохраняем эти фактические права в БД.
INSERT INTO "access_grants" (
  "id", "link_id", "project_id", "allowed_sections", "is_active", "created_at", "updated_at"
)
SELECT
  md5(link."id"::text || ':' || project."id"::text)::uuid,
  link."id",
  project."id",
  link."allowed_sections",
  true,
  NOW(),
  NOW()
FROM "access_links" AS link
JOIN "projects" AS project
  ON project."tenant_id" = link."tenant_id"
 AND project."deleted_at" IS NULL
ON CONFLICT ("link_id", "project_id") DO NOTHING;
