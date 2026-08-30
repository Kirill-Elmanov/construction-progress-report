-- CreateTable
CREATE TABLE "section_workspaces" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "section_key" TEXT NOT NULL,
    "draft_payload" JSONB,
    "draft_sequence" INTEGER NOT NULL DEFAULT 0,
    "draft_updated_at" TIMESTAMPTZ,
    "draft_actor_kind" TEXT,
    "draft_actor_id" UUID,
    "draft_actor_name" TEXT,
    "draft_actor_email" TEXT,
    "draft_actor_role" TEXT,
    "current_revision_id" UUID,
    "based_on_revision_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "section_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section_revisions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "source_draft_sequence" INTEGER NOT NULL,
    "correction_of_id" UUID,
    "actor_kind" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_name" TEXT NOT NULL,
    "actor_email" TEXT,
    "actor_role" TEXT NOT NULL,
    "fixed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "section_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section_workspace_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actor_kind" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_name" TEXT NOT NULL,
    "actor_email" TEXT,
    "actor_role" TEXT NOT NULL,
    "summary" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "section_workspace_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "section_workspaces_current_revision_id_key" ON "section_workspaces"("current_revision_id");

-- CreateIndex
CREATE INDEX "section_workspaces_project_id_idx" ON "section_workspaces"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "section_workspaces_project_id_section_key_key" ON "section_workspaces"("project_id", "section_key");

-- CreateIndex
CREATE INDEX "section_revisions_workspace_id_fixed_at_idx" ON "section_revisions"("workspace_id", "fixed_at");

-- CreateIndex
CREATE UNIQUE INDEX "section_revisions_workspace_id_version_key" ON "section_revisions"("workspace_id", "version");

-- CreateIndex
CREATE INDEX "section_workspace_events_workspace_id_created_at_idx" ON "section_workspace_events"("workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "section_workspaces" ADD CONSTRAINT "section_workspaces_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_workspaces" ADD CONSTRAINT "section_workspaces_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "section_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_workspaces" ADD CONSTRAINT "section_workspaces_based_on_revision_id_fkey" FOREIGN KEY ("based_on_revision_id") REFERENCES "section_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_revisions" ADD CONSTRAINT "section_revisions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "section_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_revisions" ADD CONSTRAINT "section_revisions_correction_of_id_fkey" FOREIGN KEY ("correction_of_id") REFERENCES "section_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_workspace_events" ADD CONSTRAINT "section_workspace_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "section_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Переносим последние заполненные данные в локальные черновики.
-- Зафиксированную версию намеренно не создаём: руководитель должен проверить
-- перенесённые значения и впервые зафиксировать их осознанно в интерфейсе.

WITH latest AS (
    SELECT DISTINCT ON (r."project_id") r."project_id", r."created_at", b.*
    FROM "reports" r
    JOIN "budget_weekly" b ON b."report_id" = r."id"
    ORDER BY r."project_id", r."week_friday" DESC, r."version" DESC
)
INSERT INTO "section_workspaces" (
    "id", "project_id", "section_key", "draft_payload", "draft_sequence",
    "draft_updated_at", "created_at", "updated_at"
)
SELECT gen_random_uuid(), "project_id", 'budget',
       jsonb_build_object('budget', jsonb_build_object(
           'paidGp', "paid_gp", 'worksAccepted', "works_accepted", 'comment', "comment"
       )),
       1, "created_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM latest;

WITH latest AS (
    SELECT DISTINCT ON (r."project_id") r."project_id", r."created_at", rd.*
    FROM "reports" r
    JOIN "rd_development" rd ON rd."report_id" = r."id"
    ORDER BY r."project_id", r."week_friday" DESC, r."version" DESC
)
INSERT INTO "section_workspaces" (
    "id", "project_id", "section_key", "draft_payload", "draft_sequence",
    "draft_updated_at", "created_at", "updated_at"
)
SELECT gen_random_uuid(), "project_id", 'rd',
       jsonb_build_object('rdDevelopment', jsonb_build_object(
           'volumesTotal', "volumes_total", 'handedToCustomer', "handed_to_customer",
           'onReview', "on_review", 'issuedVpr', "issued_vpr",
           'inProgress', "in_progress", 'withRemarks', "with_remarks"
       )),
       1, "created_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM latest;

WITH latest AS (
    SELECT DISTINCT ON (r."project_id") r."project_id", r."created_at", p.*
    FROM "reports" r
    JOIN "prescriptions" p ON p."report_id" = r."id"
    ORDER BY r."project_id", r."week_friday" DESC, r."version" DESC
)
INSERT INTO "section_workspaces" (
    "id", "project_id", "section_key", "draft_payload", "draft_sequence",
    "draft_updated_at", "created_at", "updated_at"
)
SELECT gen_random_uuid(), "project_id", 'prescriptions',
       jsonb_build_object('prescriptions', jsonb_build_object(
           'issuedTotal', "issued_total", 'resolvedTotal', "resolved_total"
       )),
       1, "created_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM latest;

WITH latest AS (
    SELECT DISTINCT ON (r."project_id") r."project_id", r."created_at", rw.*
    FROM "reports" r
    JOIN "resources_weekly" rw ON rw."report_id" = r."id"
    ORDER BY r."project_id", r."week_friday" DESC, r."version" DESC
)
INSERT INTO "section_workspaces" (
    "id", "project_id", "section_key", "draft_payload", "draft_sequence",
    "draft_updated_at", "created_at", "updated_at"
)
SELECT gen_random_uuid(), "project_id", 'resources',
       jsonb_build_object('resources', jsonb_build_object(
           'itr', "itr", 'workers', "workers", 'machinery', "machinery", 'comment', "comment"
       )),
       1, "created_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM latest;

WITH latest AS (
    SELECT DISTINCT ON (r."project_id") r."id" AS "report_id", r."project_id", r."created_at"
    FROM "reports" r
    WHERE EXISTS (SELECT 1 FROM "work_log" w WHERE w."report_id" = r."id")
       OR EXISTS (SELECT 1 FROM "section_progress" p WHERE p."report_id" = r."id")
    ORDER BY r."project_id", r."week_friday" DESC, r."version" DESC
)
INSERT INTO "section_workspaces" (
    "id", "project_id", "section_key", "draft_payload", "draft_sequence",
    "draft_updated_at", "created_at", "updated_at"
)
SELECT gen_random_uuid(), latest."project_id", 'worklog',
       jsonb_build_object(
           'worklog', COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                   'id', w."id", 'contractorId', w."contractor_id", 'sectionId', w."section_id",
                   'description', w."description", 'percentDone', w."percent_done"
               ) ORDER BY w."id")
               FROM "work_log" w WHERE w."report_id" = latest."report_id"
           ), '[]'::jsonb),
           'progress', COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                   'id', p."id", 'sectionId', p."section_id", 'percentDone', p."percent_done",
                   'factStart', to_char(p."fact_start", 'YYYY-MM-DD'),
                   'factFinish', to_char(p."fact_finish", 'YYYY-MM-DD'),
                   'comment', p."comment", 'isCritical', p."is_critical"
               ) ORDER BY p."section_id")
               FROM "section_progress" p WHERE p."report_id" = latest."report_id"
           ), '[]'::jsonb)
       ),
       1, latest."created_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM latest;

WITH latest AS (
    SELECT DISTINCT ON (r."project_id") r."id" AS "report_id", r."project_id", r."created_at"
    FROM "reports" r
    WHERE EXISTS (SELECT 1 FROM "issues" i WHERE i."report_id" = r."id")
    ORDER BY r."project_id", r."week_friday" DESC, r."version" DESC
)
INSERT INTO "section_workspaces" (
    "id", "project_id", "section_key", "draft_payload", "draft_sequence",
    "draft_updated_at", "created_at", "updated_at"
)
SELECT gen_random_uuid(), latest."project_id", 'issues',
       jsonb_build_object('issues', (
           SELECT jsonb_agg(jsonb_build_object(
               'id', i."id", 'description', i."description", 'status', i."status",
               'action', i."action", 'responsible', i."responsible",
               'dueDate', to_char(i."due_date", 'YYYY-MM-DD'),
               'resolvedDate', to_char(i."resolved_date", 'YYYY-MM-DD'),
               'isArchived', i."is_archived"
           ) ORDER BY i."created_at")
           FROM "issues" i WHERE i."report_id" = latest."report_id"
       )),
       1, latest."created_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM latest;

WITH latest AS (
    SELECT DISTINCT ON (r."project_id") r."id" AS "report_id", r."project_id", r."created_at"
    FROM "reports" r
    WHERE EXISTS (SELECT 1 FROM "photos" p WHERE p."report_id" = r."id")
    ORDER BY r."project_id", r."week_friday" DESC, r."version" DESC
)
INSERT INTO "section_workspaces" (
    "id", "project_id", "section_key", "draft_payload", "draft_sequence",
    "draft_updated_at", "created_at", "updated_at"
)
SELECT gen_random_uuid(), latest."project_id", 'photos',
       jsonb_build_object('photos', (
           SELECT jsonb_agg(jsonb_build_object(
               'id', p."id", 'caption', p."caption", 'sectionId', p."section_id",
               'shotDate', to_char(p."shot_date", 'YYYY-MM-DD'), 'sortOrder', p."sort_order",
               'fileUrl', '/api/v1/photos/' || p."id" || '/file',
               'thumbUrl', '/api/v1/photos/' || p."id" || '/thumb'
           ) ORDER BY p."sort_order")
           FROM "photos" p WHERE p."report_id" = latest."report_id"
       )),
       1, latest."created_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM latest;
