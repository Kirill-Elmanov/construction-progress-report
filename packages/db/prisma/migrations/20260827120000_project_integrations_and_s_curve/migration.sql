-- Правки v6: каждая Google-таблица и версия PLAN-R принадлежат конкретному проекту.
ALTER TABLE "projects"
  ADD COLUMN "rd_sheet_url" TEXT,
  ADD COLUMN "schedule_report_mode" TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_schedule_report_mode_check"
  CHECK ("schedule_report_mode" IN ('manual', 's_curve'));

-- Последний снимок PLAN-R хранится отдельно от ручной резервной таблицы.
CREATE TABLE "planr_schedule_items" (
  "id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "wbs_id" TEXT NOT NULL,
  "parent_wbs_id" TEXT,
  "code" TEXT,
  "name" TEXT NOT NULL,
  "node_type" TEXT,
  "target_start" DATE,
  "target_finish" DATE,
  "forecast_start" DATE,
  "forecast_finish" DATE,
  "percent_done" DECIMAL(5,2),
  "sort_order" INTEGER NOT NULL,
  "synced_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "planr_schedule_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "planr_schedule_items_project_id_wbs_id_key"
  ON "planr_schedule_items"("project_id", "wbs_id");
CREATE INDEX "planr_schedule_items_project_id_parent_wbs_id_idx"
  ON "planr_schedule_items"("project_id", "parent_wbs_id");
ALTER TABLE "planr_schedule_items"
  ADD CONSTRAINT "planr_schedule_items_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Накопительный факт по отчётным датам формирует сплошную зелёную линию.
CREATE TABLE "planr_progress_points" (
  "id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "scope_wbs_id" TEXT NOT NULL,
  "scope_name" TEXT NOT NULL,
  "as_of_date" DATE NOT NULL,
  "percent_done" DECIMAL(5,2) NOT NULL,
  "captured_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "planr_progress_points_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "planr_progress_points_project_id_scope_wbs_id_as_of_date_key"
  ON "planr_progress_points"("project_id", "scope_wbs_id", "as_of_date");
CREATE INDEX "planr_progress_points_project_id_as_of_date_idx"
  ON "planr_progress_points"("project_id", "as_of_date");
ALTER TABLE "planr_progress_points"
  ADD CONSTRAINT "planr_progress_points_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
