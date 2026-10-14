-- Phone app slice 2: delayed "task completed" notification, cancel-on-undo.
--
-- Durable timestamp of when the delayed "task completed" notification should fire
-- (completed_at + reopen_window_minutes). Stamped by completeTask instead of
-- notifying inline; cleared by reopenTask's within-window undo so a sweep job
-- (reusing the existing @Cron infrastructure) skips it.

-- ── tasks: new column ───────────────────────────────────────────────────────
ALTER TABLE "tasks" ADD COLUMN     "pending_completion_notification_at" TIMESTAMP(3);

-- ── tasks: index for the sweep's query ──────────────────────────────────────
CREATE INDEX "tasks_pending_completion_notification_at_idx" ON "tasks"("pending_completion_notification_at");
