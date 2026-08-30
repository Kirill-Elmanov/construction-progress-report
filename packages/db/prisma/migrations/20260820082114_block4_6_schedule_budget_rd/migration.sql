-- AlterTable
ALTER TABLE "budget_weekly" ADD COLUMN     "paid_gp" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "works_accepted" BIGINT NOT NULL DEFAULT 0,
ALTER COLUMN "rd_stage" DROP NOT NULL;

-- AlterTable
ALTER TABLE "work_log" ADD COLUMN     "percent_done" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "rd_development" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "volumes_total" INTEGER NOT NULL DEFAULT 0,
    "handed_to_customer" INTEGER NOT NULL DEFAULT 0,
    "on_review" INTEGER NOT NULL DEFAULT 0,
    "issued_vpr" INTEGER NOT NULL DEFAULT 0,
    "in_progress" INTEGER NOT NULL DEFAULT 0,
    "with_remarks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rd_development_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rd_development_report_id_key" ON "rd_development"("report_id");

-- AddForeignKey
ALTER TABLE "rd_development" ADD CONSTRAINT "rd_development_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
