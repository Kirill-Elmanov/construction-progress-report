-- DropForeignKey
ALTER TABLE "access_links" DROP CONSTRAINT "access_links_project_id_fkey";

-- AlterTable
ALTER TABLE "access_links" ADD COLUMN     "email" TEXT,
ADD COLUMN     "last_used_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "section_audit" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "section_key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_kind" TEXT NOT NULL,
    "actor_user_id" UUID,
    "actor_link_id" UUID,
    "actor_name" TEXT NOT NULL,
    "actor_email" TEXT,
    "actor_role" TEXT NOT NULL,
    "summary" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "section_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "section_audit_report_id_section_key_idx" ON "section_audit"("report_id", "section_key");

-- AddForeignKey
ALTER TABLE "access_links" ADD CONSTRAINT "access_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_audit" ADD CONSTRAINT "section_audit_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_audit" ADD CONSTRAINT "section_audit_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_audit" ADD CONSTRAINT "section_audit_actor_link_id_fkey" FOREIGN KEY ("actor_link_id") REFERENCES "access_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;
