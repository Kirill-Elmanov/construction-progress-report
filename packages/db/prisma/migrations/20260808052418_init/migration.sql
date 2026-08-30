-- CreateEnum
CREATE TYPE "role_type" AS ENUM ('pzgd', 'gip', 'stroycontrol', 'ksp', 'viewer');

-- CreateEnum
CREATE TYPE "traffic_light" AS ENUM ('green', 'yellow', 'red');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('draft', 'finalized');

-- CreateEnum
CREATE TYPE "issue_status" AS ENUM ('green', 'yellow', 'red');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "contractor" TEXT NOT NULL,
    "plan_start" DATE NOT NULL,
    "plan_finish" DATE NOT NULL,
    "budget" BIGINT NOT NULL,
    "tep_area" DECIMAL(14,2),
    "tep_power" TEXT,
    "tep_extra" JSONB,
    "preview_photo_key" TEXT,
    "delay_yellow_days" INTEGER NOT NULL DEFAULT 5,
    "delay_red_days" INTEGER NOT NULL DEFAULT 14,
    "rd_stages" JSONB NOT NULL,
    "planr_attr_map" JSONB,
    "planr_eps_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_links" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "role" "role_type" NOT NULL,
    "allowed_sections" TEXT[],
    "display_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractors" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_person" TEXT,
    "phone" TEXT,

    CONSTRAINT "contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "sort_order" INTEGER NOT NULL,
    "contractor_id" UUID,
    "plan_start" DATE NOT NULL,
    "plan_finish" DATE NOT NULL,
    "planr_wbs_id" TEXT,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "week_friday" DATE NOT NULL,
    "status" "report_status" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "parent_report_id" UUID,
    "finalized_at" TIMESTAMPTZ,
    "finalized_by" TEXT,
    "pdf_key" TEXT,
    "dashboard_token" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section_progress" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "percent_done" DECIMAL(5,2) NOT NULL,
    "fact_start" DATE,
    "fact_finish" DATE,
    "comment" TEXT,
    "is_critical" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "section_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "parent_issue_id" UUID,
    "description" TEXT NOT NULL,
    "status" "issue_status" NOT NULL,
    "action" TEXT NOT NULL,
    "responsible" TEXT,
    "due_date" DATE NOT NULL,
    "resolved_date" DATE,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "issued_total" INTEGER NOT NULL,
    "resolved_total" INTEGER NOT NULL,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_weekly" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "spent_total" BIGINT NOT NULL,
    "rd_stage" TEXT NOT NULL,
    "comment" TEXT,

    CONSTRAINT "budget_weekly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources_weekly" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "itr" INTEGER NOT NULL,
    "workers" INTEGER NOT NULL,
    "machinery" INTEGER NOT NULL,
    "comment" TEXT,

    CONSTRAINT "resources_weekly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_log" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "contractor_id" UUID NOT NULL,
    "section_id" UUID,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "volume_week" DECIMAL(14,3),
    "volume_total" DECIMAL(14,3),

    CONSTRAINT "work_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "thumb_key" TEXT NOT NULL,
    "caption" TEXT,
    "section_id" UUID,
    "shot_date" DATE,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_tenant_id_idx" ON "projects"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "access_links_token_key" ON "access_links"("token");

-- CreateIndex
CREATE INDEX "access_links_project_id_idx" ON "access_links"("project_id");

-- CreateIndex
CREATE INDEX "contractors_project_id_idx" ON "contractors"("project_id");

-- CreateIndex
CREATE INDEX "sections_project_id_idx" ON "sections"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "reports_dashboard_token_key" ON "reports"("dashboard_token");

-- CreateIndex
CREATE INDEX "reports_project_id_status_idx" ON "reports"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reports_project_id_week_friday_version_key" ON "reports"("project_id", "week_friday", "version");

-- CreateIndex
CREATE UNIQUE INDEX "section_progress_report_id_section_id_key" ON "section_progress"("report_id", "section_id");

-- CreateIndex
CREATE INDEX "issues_report_id_idx" ON "issues"("report_id");

-- CreateIndex
CREATE UNIQUE INDEX "prescriptions_report_id_key" ON "prescriptions"("report_id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_weekly_report_id_key" ON "budget_weekly"("report_id");

-- CreateIndex
CREATE UNIQUE INDEX "resources_weekly_report_id_key" ON "resources_weekly"("report_id");

-- CreateIndex
CREATE INDEX "work_log_report_id_idx" ON "work_log"("report_id");

-- CreateIndex
CREATE INDEX "photos_report_id_idx" ON "photos"("report_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_links" ADD CONSTRAINT "access_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_parent_report_id_fkey" FOREIGN KEY ("parent_report_id") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_progress" ADD CONSTRAINT "section_progress_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_progress" ADD CONSTRAINT "section_progress_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_parent_issue_id_fkey" FOREIGN KEY ("parent_issue_id") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_weekly" ADD CONSTRAINT "budget_weekly_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources_weekly" ADD CONSTRAINT "resources_weekly_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_log" ADD CONSTRAINT "work_log_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_log" ADD CONSTRAINT "work_log_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_log" ADD CONSTRAINT "work_log_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
