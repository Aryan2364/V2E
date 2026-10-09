-- Workflows engine rebuild: instance steps carry a frozen snapshot of their template
-- step and their own main-sequence order; instances/steps record their last engine
-- error; task-based triggers dedupe per (trigger, task); date triggers remember the
-- occurrence they last fired.

-- AlterTable
ALTER TABLE "workflow_instance_steps" ADD COLUMN     "last_error" TEXT,
ADD COLUMN     "order_index" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "step_snapshot" JSONB,
ALTER COLUMN "assigned_to_user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "workflow_instances" ADD COLUMN     "last_error" TEXT,
ADD COLUMN     "source_task_id" TEXT,
ADD COLUMN     "trigger_id" TEXT;

-- AlterTable
ALTER TABLE "workflow_triggers" ADD COLUMN     "last_fired_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "workflow_instance_steps_workflow_instance_id_order_index_idx" ON "workflow_instance_steps"("workflow_instance_id", "order_index");

-- CreateIndex
CREATE INDEX "workflow_instance_steps_organization_id_status_idx" ON "workflow_instance_steps"("organization_id", "status");

-- CreateIndex
CREATE INDEX "workflow_instance_steps_task_id_idx" ON "workflow_instance_steps"("task_id");

-- CreateIndex
CREATE INDEX "workflow_instances_organization_id_status_idx" ON "workflow_instances"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_instances_trigger_id_source_task_id_key" ON "workflow_instances"("trigger_id", "source_task_id");

-- ─── Backfill existing instances ─────────────────────────────────────────────────
-- Freeze every existing instance step against the template step it was created
-- from, so later template edits no longer reach running instances. Rows whose
-- template step is already gone keep a NULL snapshot (the engine marks such an
-- instance stuck instead of silently hanging).

-- 1. Main-sequence order + snapshot from the live template step (escalation target
--    snapshot embedded under "branch_step").
UPDATE "workflow_instance_steps" wis
SET "order_index" = ws."order_index",
    "step_snapshot" = jsonb_build_object(
      'title', ws."title",
      'description', ws."description",
      'assignee_type', ws."assignee_type"::text,
      'assignee_user_id', ws."assignee_user_id",
      'assignee_role', ws."assignee_role",
      'assigner_user_id', ws."assigner_user_id",
      'deadline_config', ws."deadline_config",
      'proof_required', ws."proof_required",
      'priority_id', ws."priority_id",
      'category_id', ws."category_id",
      'checklist_items', ws."checklist_items",
      'if_overdue_action', ws."if_overdue_action"::text,
      'branch_step_id', ws."branch_step_id",
      'is_branch_step', ws."is_branch_step",
      'order_index', ws."order_index",
      'is_branch', false,
      'branch_step', (
        SELECT jsonb_build_object(
          'title', b."title",
          'description', b."description",
          'assignee_type', b."assignee_type"::text,
          'assignee_user_id', b."assignee_user_id",
          'assignee_role', b."assignee_role",
          'assigner_user_id', b."assigner_user_id",
          'deadline_config', b."deadline_config",
          'proof_required', b."proof_required",
          'priority_id', b."priority_id",
          'category_id', b."category_id",
          'checklist_items', b."checklist_items",
          'if_overdue_action', b."if_overdue_action"::text,
          'branch_step_id', NULL,
          'is_branch_step', true,
          'order_index', b."order_index",
          'workflow_step_id', b."id"
        )
        FROM "workflow_steps" b
        WHERE b."id" = ws."branch_step_id" AND b."workflow_template_id" = ws."workflow_template_id"
      )
    )
FROM "workflow_steps" ws
WHERE ws."id" = wis."workflow_step_id";

-- 2. Legacy escalation rows (created by the old trigger_branch path, which also put the
--    target in the main sequence): mark them as escalation rows hanging off the step
--    that branched, at that step's position.
UPDATE "workflow_instance_steps" br
SET "step_snapshot" = br."step_snapshot" || jsonb_build_object('is_branch', true, 'parent_instance_step_id', parent."id"),
    "order_index" = parent."order_index"
FROM "workflow_instance_steps" parent
JOIN "workflow_steps" pws ON pws."id" = parent."workflow_step_id"
WHERE parent."workflow_instance_id" = br."workflow_instance_id"
  AND parent."branch_taken" = true
  AND pws."branch_step_id" = br."workflow_step_id"
  AND br."created_at" > parent."created_at"
  AND br."step_snapshot" IS NOT NULL;

-- 3. Old semantics parked the branching step as 'branched' and moved current_step_id to
--    the escalation row. New semantics: the step is 'overdue' and the main sequence
--    still waits on it.
UPDATE "workflow_instances" wi
SET "current_step_id" = parent."id"
FROM "workflow_instance_steps" parent
WHERE parent."workflow_instance_id" = wi."id"
  AND parent."status" = 'branched'
  AND wi."status" IN ('running', 'stuck');

UPDATE "workflow_instance_steps" SET "status" = 'overdue', "branch_taken" = true WHERE "status" = 'branched';
