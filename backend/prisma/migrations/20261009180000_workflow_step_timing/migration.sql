-- Workflows: step timing.
--
--  * workflow_steps.start_rule / due_rule (JSON, nullable): when a step starts and
--    when it is due — `{ kind, ...params, time: 'HH:mm' }` (see
--    src/workflows/engine/timing.ts). NULL = legacy behaviour (start as soon as the
--    steps before it are done; due = due_days after the start at due_time), so every
--    existing step keeps working exactly as before.
--  * workflow_instance_steps.planned_start_at / planned_due_at: the dates planned for
--    each step when the run is created (shown on the run page).
--  * workflow_instance_steps.start_at: set while a ready step waits for its start
--    time; the engine's 15-minute tick activates it then.
-- Additive only.

-- AlterTable
ALTER TABLE "workflow_steps" ADD COLUMN IF NOT EXISTS "start_rule" JSONB;
ALTER TABLE "workflow_steps" ADD COLUMN IF NOT EXISTS "due_rule" JSONB;

-- AlterTable
ALTER TABLE "workflow_instance_steps" ADD COLUMN IF NOT EXISTS "planned_start_at" TIMESTAMP(3);
ALTER TABLE "workflow_instance_steps" ADD COLUMN IF NOT EXISTS "planned_due_at" TIMESTAMP(3);
ALTER TABLE "workflow_instance_steps" ADD COLUMN IF NOT EXISTS "start_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_instance_steps_organization_id_status_start_at_idx"
  ON "workflow_instance_steps"("organization_id", "status", "start_at");
