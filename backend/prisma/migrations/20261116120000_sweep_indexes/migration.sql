-- Indexes for the overdue / reminder sweeps (filter by org + deadline / is_overdue / is_sent+remind_at).
-- CreateIndex
CREATE INDEX IF NOT EXISTS "tasks_organization_id_deadline_idx" ON "tasks"("organization_id", "deadline");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tasks_organization_id_is_overdue_idx" ON "tasks"("organization_id", "is_overdue");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "task_reminders_organization_id_is_sent_remind_at_idx" ON "task_reminders"("organization_id", "is_sent", "remind_at");
