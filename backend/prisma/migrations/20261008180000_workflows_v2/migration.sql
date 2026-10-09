-- Workflows v2: "a step is a task the system creates". Steps gain multi-assignee task
-- fields, a due rule (N days after the step starts, at a time), an escalation rule,
-- an if-late rule and their dependencies (a DAG); instance rows gain send-back state;
-- runs gain an event history and run-level documents. Old columns stay (unused).
--
-- Postgres: ALTER TYPE ... ADD VALUE may not be USED in the same transaction it is
-- added in. Nothing below uses the new enum values, so this migration is safe whether
-- or not it runs inside a transaction block.

-- AlterEnum
ALTER TYPE "WorkflowStepStatus" ADD VALUE IF NOT EXISTS 'sent_back';
ALTER TYPE "WorkflowStepStatus" ADD VALUE IF NOT EXISTS 'moved_on';

-- AlterTable
ALTER TABLE "workflow_instance_steps" ADD COLUMN     "returned_to_row_id" TEXT,
ADD COLUMN     "sent_back_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "waiting_on_row_id" TEXT;

-- AlterTable
ALTER TABLE "workflow_steps" ADD COLUMN     "assignee_user_ids" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "cc_user_ids" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "completion_mode" "CompletionMode" NOT NULL DEFAULT 'any_can_complete',
ADD COLUMN     "depends_on_step_ids" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "due_days" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "due_time" TEXT NOT NULL DEFAULT '18:00',
ADD COLUMN     "escalation_mode" TEXT NOT NULL DEFAULT 'manager',
ADD COLUMN     "escalation_user_ids" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "if_late" TEXT NOT NULL DEFAULT 'wait',
ADD COLUMN     "proof_allowed_extensions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "tag_ids" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "workflow_instance_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workflow_instance_id" TEXT NOT NULL,
    "instance_step_id" TEXT,
    "type" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_instance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instance_attachments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workflow_instance_id" TEXT NOT NULL,
    "uploaded_by_user_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "workflow_instance_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_instance_events_workflow_instance_id_created_at_idx" ON "workflow_instance_events"("workflow_instance_id", "created_at");

-- CreateIndex
CREATE INDEX "workflow_instance_events_organization_id_idx" ON "workflow_instance_events"("organization_id");

-- CreateIndex
CREATE INDEX "workflow_instance_attachments_workflow_instance_id_idx" ON "workflow_instance_attachments"("workflow_instance_id");

-- CreateIndex
CREATE INDEX "workflow_instance_attachments_organization_id_idx" ON "workflow_instance_attachments"("organization_id");

-- AddForeignKey
ALTER TABLE "workflow_instance_events" ADD CONSTRAINT "workflow_instance_events_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instance_attachments" ADD CONSTRAINT "workflow_instance_attachments_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Backfill existing templates ─────────────────────────────────────────────────
-- Escalation steps (is_branch_step = true) are left untouched: the v2 engine and API
-- ignore them.

-- 1. Main steps become a straight chain: each starts after the previous main step
--    (by order_index, then created_at); the first starts with the run.
WITH ordered AS (
  SELECT "id",
         LAG("id") OVER (PARTITION BY "workflow_template_id" ORDER BY "order_index", "created_at", "id") AS prev_id
  FROM "workflow_steps"
  WHERE "is_branch_step" = false
)
UPDATE "workflow_steps" ws
SET "depends_on_step_ids" = CASE WHEN o.prev_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(o.prev_id) END
FROM ordered o
WHERE o."id" = ws."id";

-- 2. The fixed person becomes the (single) assignee.
UPDATE "workflow_steps"
SET "assignee_user_ids" = jsonb_build_array("assignee_user_id")
WHERE "assignee_user_id" IS NOT NULL AND "assignee_user_id" <> '';

-- 3. Due rule from the old deadline config: x_days_* keep their day count (0–365),
--    every other type becomes 1 day; the configured time when it reads as HH:mm.
UPDATE "workflow_steps"
SET "due_days" = CASE
      WHEN "deadline_config"->>'type' IN ('x_days_after_start', 'x_days_after_prev_completed', 'x_days_after_prev_deadline')
           AND ("deadline_config"->>'days') ~ '^\s*[0-9]{1,6}\s*$'
        THEN LEAST(365, GREATEST(0, trim("deadline_config"->>'days')::int))
      ELSE 1
    END,
    "due_time" = CASE
      WHEN ("deadline_config"->>'time') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN "deadline_config"->>'time'
      ELSE '18:00'
    END
WHERE jsonb_typeof("deadline_config") = 'object';

-- 4. If late: "proceed anyway" → move on; everything else → wait.
UPDATE "workflow_steps"
SET "if_late" = CASE WHEN "if_overdue_action" = 'proceed_anyway' THEN 'move_on' ELSE 'wait' END;
