-- Правки v4: дополнительные бюджетные показатели задаются отдельно и не
-- участвуют в расчёте освоения. Старое Б2 переносим как первый показатель.
ALTER TABLE "budget_weekly"
ADD COLUMN "optional_fields" JSONB NOT NULL DEFAULT '[]'::JSONB;

UPDATE "budget_weekly"
SET "optional_fields" = CASE
  WHEN "works_accepted" <> 0 THEN jsonb_build_array(jsonb_build_object(
    'id', 'legacy-works-accepted',
    'label', 'Принято работ',
    'value', "works_accepted"
  ))
  ELSE '[]'::JSONB
END,
"spent_total" = "paid_gp";

-- История отчётов и аудита должна сохраняться после удаления отключённой
-- учётной записи или больше не нужного токена специалиста.
ALTER TABLE "access_links" DROP CONSTRAINT IF EXISTS "access_links_created_by_fkey";
ALTER TABLE "access_links" ADD CONSTRAINT "access_links_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "reports" DROP CONSTRAINT IF EXISTS "reports_finalized_by_fkey";
ALTER TABLE "reports" ADD CONSTRAINT "reports_finalized_by_fkey"
  FOREIGN KEY ("finalized_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "section_audit" DROP CONSTRAINT IF EXISTS "section_audit_actor_user_id_fkey";
ALTER TABLE "section_audit" ADD CONSTRAINT "section_audit_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "section_audit" DROP CONSTRAINT IF EXISTS "section_audit_actor_link_id_fkey";
ALTER TABLE "section_audit" ADD CONSTRAINT "section_audit_actor_link_id_fkey"
  FOREIGN KEY ("actor_link_id") REFERENCES "access_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;
