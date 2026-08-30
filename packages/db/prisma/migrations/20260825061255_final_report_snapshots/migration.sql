-- CreateTable
CREATE TABLE "report_section_snapshots" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "section_key" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL,
    "revision_id" UUID,
    "payload" JSONB NOT NULL,
    "captured_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_section_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_section_snapshots_revision_id_idx" ON "report_section_snapshots"("revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_section_snapshots_report_id_section_key_key" ON "report_section_snapshots"("report_id", "section_key");

-- AddForeignKey
ALTER TABLE "report_section_snapshots" ADD CONSTRAINT "report_section_snapshots_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_section_snapshots" ADD CONSTRAINT "report_section_snapshots_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "section_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
