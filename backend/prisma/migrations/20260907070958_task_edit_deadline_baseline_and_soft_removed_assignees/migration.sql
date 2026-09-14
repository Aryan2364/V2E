-- AlterTable
ALTER TABLE "task_assignees" ADD COLUMN     "removed_at" TIMESTAMP(3),
ADD COLUMN     "removed_by_user_id" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "deadline_revision_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "original_deadline" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "task_deadline_revisions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "from_deadline" TIMESTAMP(3),
    "to_deadline" TIMESTAMP(3),
    "reason" TEXT,
    "changed_by_user_id" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_deadline_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_deadline_revisions_task_id_idx" ON "task_deadline_revisions"("task_id");

-- CreateIndex
CREATE INDEX "task_deadline_revisions_organization_id_idx" ON "task_deadline_revisions"("organization_id");

-- CreateIndex
CREATE INDEX "task_assignees_task_id_removed_at_idx" ON "task_assignees"("task_id", "removed_at");

-- CreateIndex
CREATE INDEX "task_assignees_organization_id_user_id_removed_at_idx" ON "task_assignees"("organization_id", "user_id", "removed_at");

-- AddForeignKey
ALTER TABLE "task_deadline_revisions" ADD CONSTRAINT "task_deadline_revisions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: adopt each existing task's CURRENT deadline as its frozen baseline.
--
-- Deliberately not "the earliest deadline we can reconstruct from the audit log".
-- Seeding the baseline with the live value means no historical report number moves
-- the moment this ships — every task that is on-time today stays on-time today.
-- Only revisions made from here on are held against the original date.
UPDATE "tasks" SET "original_deadline" = "deadline" WHERE "deadline" IS NOT NULL;
