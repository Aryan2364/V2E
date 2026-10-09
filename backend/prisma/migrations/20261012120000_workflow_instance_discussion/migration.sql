-- Workflows: one discussion per instance.
--
--  * task_comments is the one store for an instance's discussion. Every message of an
--    instance carries `workflow_instance_id`: messages written on a step task keep their
--    `task_id`; messages written on the instance page have no task (`task_id` NULL).
--    New columns: `for_instance_step_id` ("For <later step>" tag), `mentioned_user_ids`,
--    and `sent_back_from_row_id` / `sent_back_to_row_id` (the reason a send-back posted).
--  * Existing comments on workflow step tasks are linked to their instance.
--  * Existing send-back comments ("Sent back from “X”: why") are marked from their
--    `sent_back` history entry; their text becomes the reason alone (the steps are now
--    columns, and the history entry keeps the original wording).
--  * workflow_instance_notes are moved into task_comments as instance-level messages
--    (same ids, authors, times, step tags; deleted notes stay deleted), then the notes
--    table is dropped. No note is lost.
--  * workflow_instance_attachments.comment_id: files attached to an instance-level
--    message.
--  * workflow_discussion_reads: per-person "read up to" marker for unread counts.

-- ── task_comments: new columns ──────────────────────────────────────────────
ALTER TABLE "task_comments" ADD COLUMN     "for_instance_step_id" TEXT,
ADD COLUMN     "mentioned_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sent_back_from_row_id" TEXT,
ADD COLUMN     "sent_back_to_row_id" TEXT,
ADD COLUMN     "workflow_instance_id" TEXT,
ALTER COLUMN "task_id" DROP NOT NULL;

-- ── Link comments on workflow step tasks to their instance ─────────────────
UPDATE "task_comments" c
SET "workflow_instance_id" = s."workflow_instance_id"
FROM "tasks" t
JOIN "workflow_instance_steps" s
  ON s."id" = t."workflow_instance_step_id" AND s."organization_id" = t."organization_id"
WHERE c."task_id" = t."id"
  AND c."organization_id" = t."organization_id"
  AND t."workflow_instance_step_id" IS NOT NULL;

-- ── Mark existing send-back comments ────────────────────────────────────────
UPDATE "task_comments" c
SET "sent_back_from_row_id" = e."metadata"->>'from_row_id',
    "sent_back_to_row_id"   = e."metadata"->>'to_row_id',
    "body" = COALESCE(NULLIF(btrim(e."metadata"->>'reason'), ''), c."body")
FROM "workflow_instance_events" e
WHERE e."type" = 'sent_back'
  AND e."organization_id" = c."organization_id"
  AND e."metadata"->>'comment_id' = c."id";

-- ── Instance notes → instance-level messages ───────────────────────────────
INSERT INTO "task_comments" (
  "id", "organization_id", "task_id", "user_id", "body", "workflow_instance_id",
  "for_instance_step_id", "mentioned_user_ids", "is_deleted", "deleted_at", "created_at", "updated_at"
)
SELECT n."id", n."organization_id", NULL, n."author_user_id", n."body", n."workflow_instance_id",
       n."for_instance_step_id", ARRAY[]::TEXT[], n."deleted_at" IS NOT NULL, n."deleted_at",
       n."created_at", COALESCE(n."deleted_at", n."created_at")
FROM "workflow_instance_notes" n
ON CONFLICT ("id") DO NOTHING;

-- History entries of notes keep pointing at the same id (now a message id).

-- ── Drop the notes table (its rows are now messages) ───────────────────────
ALTER TABLE "workflow_instance_notes" DROP CONSTRAINT "workflow_instance_notes_workflow_instance_id_fkey";
DROP TABLE "workflow_instance_notes";

-- ── Instance files: the message they were attached to ──────────────────────
ALTER TABLE "workflow_instance_attachments" ADD COLUMN     "comment_id" TEXT;

-- ── Per-person read markers ────────────────────────────────────────────────
CREATE TABLE "workflow_discussion_reads" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workflow_instance_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "last_read_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_discussion_reads_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX "workflow_discussion_reads_organization_id_user_id_idx" ON "workflow_discussion_reads"("organization_id", "user_id");
CREATE UNIQUE INDEX "workflow_discussion_reads_workflow_instance_id_user_id_key" ON "workflow_discussion_reads"("workflow_instance_id", "user_id");
CREATE INDEX "task_comments_workflow_instance_id_created_at_idx" ON "task_comments"("workflow_instance_id", "created_at");
CREATE INDEX "task_comments_for_instance_step_id_idx" ON "task_comments"("for_instance_step_id");
CREATE INDEX "workflow_instance_attachments_comment_id_idx" ON "workflow_instance_attachments"("comment_id");

-- ── Foreign keys ───────────────────────────────────────────────────────────
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_instance_attachments" ADD CONSTRAINT "workflow_instance_attachments_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "task_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workflow_discussion_reads" ADD CONSTRAINT "workflow_discussion_reads_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
