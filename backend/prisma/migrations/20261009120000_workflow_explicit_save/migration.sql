-- Workflows: explicit save (Draft / Live / Paused / Archived), "How it starts" =
-- Manually and/or On a schedule, schedules in the recurring-task format.
--
--  * WorkflowTemplateStatus gains `paused` (Live but stopped: no new runs, schedules
--    skip, running runs continue). `active` = Live.
--  * workflow_templates.manual_start_enabled (default on).
--  * workflow_schedule_entries: the SAME columns as recurring_schedule_entries (+ the
--    template id and the last-fired marker), evaluated by the same recurrence code.
--  * Existing active `date_trigger` rows become schedule entries:
--      repeat none (and the legacy { date } shape, 09:00) → daily, ends after 1
--        (already fired → counted and finished);
--      daily → daily; weekly weekdays → weekly days (0 = Sunday, unchanged);
--      monthly day_of_month → monthly month_days (29–31 stored negative = "or the last
--        day of shorter months", which is how the old trigger clamped);
--      yearly → yearly on the start date's month/day;
--      end_date → ends on that date.
--    Disabled date triggers never fired, so they are dropped.
--  * The "task completed" / "task overdue" starts are removed: their rows are deleted.
--    Every date trigger row is deleted after the copy. The workflow_triggers table is
--    kept (unused) for history.
--  * workflow_nature / recurring_type are re-derived from the schedules.
--
-- Postgres: ALTER TYPE ... ADD VALUE may not be USED in the same transaction it is
-- added in. Nothing below uses 'paused', so this is safe inside a transaction block.

-- AlterEnum
ALTER TYPE "WorkflowTemplateStatus" ADD VALUE IF NOT EXISTS 'paused';

-- AlterTable
ALTER TABLE "workflow_templates" ADD COLUMN IF NOT EXISTS "manual_start_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "workflow_schedule_entries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workflow_template_id" TEXT NOT NULL,
    "schedule_type" "RecurringScheduleType" NOT NULL,
    "every" INTEGER NOT NULL DEFAULT 1,
    "days" JSONB NOT NULL DEFAULT '[]',
    "month_days" JSONB NOT NULL DEFAULT '[]',
    "yearly_dates" JSONB NOT NULL DEFAULT '[]',
    "time" TEXT NOT NULL DEFAULT '09:00',
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_condition" "RecurringEndCondition" NOT NULL DEFAULT 'never',
    "end_date" TIMESTAMP(3),
    "end_after" INTEGER,
    "occurrence_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "last_fired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_schedule_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_schedule_entries_workflow_template_id_idx" ON "workflow_schedule_entries"("workflow_template_id");

-- CreateIndex
CREATE INDEX "workflow_schedule_entries_organization_id_idx" ON "workflow_schedule_entries"("organization_id");

-- AddForeignKey
ALTER TABLE "workflow_schedule_entries" ADD CONSTRAINT "workflow_schedule_entries_workflow_template_id_fkey" FOREIGN KEY ("workflow_template_id") REFERENCES "workflow_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data: active date triggers → schedule entries
WITH src AS (
    SELECT
        t."organization_id",
        t."workflow_template_id",
        t."last_fired_at",
        t."created_at",
        substring(COALESCE(t."config"->>'start_date', t."config"->>'date') FROM 1 FOR 10) AS start_s,
        CASE WHEN t."config" ? 'start_date' AND (t."config"->>'time') ~ '^\d{2}:\d{2}$'
             THEN t."config"->>'time' ELSE '09:00' END AS time_s,
        CASE WHEN t."config" ? 'start_date' AND (t."config"->>'repeat') IN ('daily', 'weekly', 'monthly', 'yearly')
             THEN t."config"->>'repeat' ELSE 'none' END AS rep,
        t."config"->'weekdays' AS weekdays,
        CASE WHEN (t."config"->>'day_of_month') ~ '^\d{1,2}$' THEN (t."config"->>'day_of_month')::int END AS dom,
        CASE WHEN (t."config"->>'end_date') ~ '^\d{4}-\d{2}-\d{2}' THEN substring(t."config"->>'end_date' FROM 1 FOR 10) END AS end_s,
        (ROW_NUMBER() OVER (PARTITION BY t."workflow_template_id" ORDER BY t."created_at", t."id") - 1)::int AS ord
    FROM "workflow_triggers" t
    WHERE t."type" = 'date_trigger'
      AND t."is_active" = true
      AND COALESCE(t."config"->>'start_date', t."config"->>'date') ~ '^\d{4}-\d{2}-\d{2}'
),
norm AS (
    SELECT src.*,
           COALESCE(dom, EXTRACT(DAY FROM start_s::date)::int) AS month_day
    FROM src
)
INSERT INTO "workflow_schedule_entries" (
    "id", "organization_id", "workflow_template_id", "schedule_type", "every", "days", "month_days",
    "yearly_dates", "time", "start_date", "end_condition", "end_date", "end_after", "occurrence_count",
    "is_active", "order_index", "last_fired_at", "created_at", "updated_at"
)
SELECT
    gen_random_uuid()::text,
    "organization_id",
    "workflow_template_id",
    (CASE WHEN rep = 'none' THEN 'daily' ELSE rep END)::"RecurringScheduleType",
    1,
    CASE WHEN rep = 'weekly' AND jsonb_typeof(weekdays) = 'array' THEN weekdays ELSE '[]'::jsonb END,
    CASE WHEN rep = 'monthly'
         THEN jsonb_build_array(CASE WHEN month_day >= 29 THEN -month_day ELSE month_day END)
         ELSE '[]'::jsonb END,
    CASE WHEN rep = 'yearly'
         THEN jsonb_build_array(jsonb_build_object(
                'month', EXTRACT(MONTH FROM start_s::date)::int,
                'day', EXTRACT(DAY FROM start_s::date)::int))
         ELSE '[]'::jsonb END,
    time_s,
    start_s::date::timestamp,
    (CASE WHEN rep = 'none' THEN 'after_n' WHEN end_s IS NOT NULL THEN 'on_date' ELSE 'never' END)::"RecurringEndCondition",
    CASE WHEN rep <> 'none' AND end_s IS NOT NULL THEN end_s::date::timestamp END,
    CASE WHEN rep = 'none' THEN 1 END,
    CASE WHEN rep = 'none' AND "last_fired_at" IS NOT NULL THEN 1 ELSE 0 END,
    NOT (rep = 'none' AND "last_fired_at" IS NOT NULL),
    ord,
    "last_fired_at",
    "created_at",
    CURRENT_TIMESTAMP
FROM norm;

-- Data: the old trigger rows go (date triggers were copied above; task starts are removed)
DELETE FROM "workflow_triggers"
WHERE "type" IN ('date_trigger', 'task_completed_trigger', 'task_overdue_trigger');

-- Data: nature is derived from the schedules (a one-off "ends after 1" does not repeat)
UPDATE "workflow_templates" wt
SET "workflow_nature" = (CASE WHEN r.n > 0 THEN 'recurring' ELSE 'one_time' END)::"WorkflowNature",
    "recurring_type" = CASE WHEN r.kinds = 1 THEN r.kind::"WorkflowRecurringType" END
FROM (
    SELECT t."id",
           COUNT(e."id") AS n,
           COUNT(DISTINCT e."schedule_type") AS kinds,
           MIN(e."schedule_type"::text) AS kind
    FROM "workflow_templates" t
    LEFT JOIN "workflow_schedule_entries" e
      ON e."workflow_template_id" = t."id"
     AND NOT (e."end_condition" = 'after_n' AND e."end_after" = 1)
    GROUP BY t."id"
) r
WHERE r."id" = wt."id";

-- Data: "Manually" now has its own list of who may start the workflow by hand (the
-- `trigger` grants); owners, editors and admins no longer start it automatically.
-- Keep every existing workflow startable by the people who could start it before:
-- its creator, owners and editors join its starters (existing starters stay).
INSERT INTO "workflow_access" ("id", "organization_id", "workflow_template_id", "user_id", "access_type", "created_at")
SELECT gen_random_uuid()::text, t."organization_id", t."id", u."user_id", 'trigger'::"WorkflowAccessType", CURRENT_TIMESTAMP
FROM "workflow_templates" t
CROSS JOIN LATERAL (
    SELECT jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(t."owner_user_ids") = 'array' THEN t."owner_user_ids" ELSE '[]'::jsonb END
           ) AS "user_id"
    UNION
    SELECT t."created_by_user_id"
    UNION
    SELECT a."user_id" FROM "workflow_access" a
    WHERE a."workflow_template_id" = t."id" AND a."access_type" = 'edit'
) u
WHERE u."user_id" IS NOT NULL AND u."user_id" <> ''
ON CONFLICT ("workflow_template_id", "user_id", "access_type") DO NOTHING;
