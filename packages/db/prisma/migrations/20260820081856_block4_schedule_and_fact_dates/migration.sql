-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "build_permit" TEXT,
ADD COLUMN     "deleted_at" TIMESTAMPTZ,
ADD COLUMN     "deleted_by" UUID,
ADD COLUMN     "expertise_conclusion" TEXT,
ADD COLUMN     "general_designer" TEXT,
ADD COLUMN     "project_stage" TEXT,
ADD COLUMN     "tech_customer" TEXT,
ADD COLUMN     "technical_conditions" JSONB;

-- AlterTable
ALTER TABLE "sections" ADD COLUMN     "fact_finish" DATE,
ADD COLUMN     "fact_start" DATE;

-- CreateTable
CREATE TABLE "schedule_items" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan_start" DATE,
    "plan_finish" DATE,
    "delay_days" INTEGER,
    "percent_done" DECIMAL(5,2),
    "week_growth" DECIMAL(5,2),
    "sort_order" INTEGER NOT NULL,
    "planr_wbs_id" TEXT,

    CONSTRAINT "schedule_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedule_items_project_id_idx" ON "schedule_items"("project_id");

-- AddForeignKey
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
