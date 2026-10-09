-- Workflows: people, instance numbers + names, instance notes.
--
--  * People: the creator (`created_by_user_id`) is a permanent editor; Owners are
--    retired from access. Every existing owner other than the creator becomes an
--    editor (an `edit` grant). `owner_user_ids` is kept (back-compat) but no longer
--    read for access. Viewers use the existing `view` grant type.
--  * Instances are numbered per workflow in start order (`instance_number`, backfilled
--    by started_at); `workflow_templates.instance_seq` holds the last number handed out.
--  * Instance names are unique within a workflow, case- and space-insensitively:
--    `name_key` = trimmed, inner whitespace collapsed, lower-cased name, unique per
--    workflow. Existing names are tidied the same way and clashes are renamed
--    " (2)", " (3)"… in started_at order (the earliest keeps its name).
--  * workflow_instance_notes: notes on an instance, optionally for a later step.
--
-- Additive; no rows are removed.

-- ── People: non-creator owners → editors ────────────────────────────────────
INSERT INTO "workflow_access" ("id", "organization_id", "workflow_template_id", "user_id", "access_type", "created_at")
SELECT gen_random_uuid()::text, t."organization_id", t."id", o.uid, 'edit'::"WorkflowAccessType", now()
FROM "workflow_templates" t
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(t."owner_user_ids") = 'array' THEN t."owner_user_ids" ELSE '[]'::jsonb END
) AS o(uid)
WHERE o.uid <> '' AND o.uid <> t."created_by_user_id"
ON CONFLICT ("workflow_template_id", "user_id", "access_type") DO NOTHING;

-- ── Instance numbers ────────────────────────────────────────────────────────
ALTER TABLE "workflow_templates" ADD COLUMN IF NOT EXISTS "instance_seq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "workflow_instances" ADD COLUMN IF NOT EXISTS "instance_number" INTEGER;
ALTER TABLE "workflow_instances" ADD COLUMN IF NOT EXISTS "name_key" TEXT;

WITH numbered AS (
  SELECT "id",
         ROW_NUMBER() OVER (PARTITION BY "workflow_template_id" ORDER BY "started_at", "created_at", "id") AS rn
  FROM "workflow_instances"
)
UPDATE "workflow_instances" wi
SET "instance_number" = numbered.rn
FROM numbered
WHERE wi."id" = numbered."id";

UPDATE "workflow_templates" t
SET "instance_seq" = COALESCE(
  (SELECT MAX(i."instance_number") FROM "workflow_instances" i WHERE i."workflow_template_id" = t."id"),
  0
);

-- ── Instance names: tidy, then de-duplicate per workflow ───────────────────
UPDATE "workflow_instances"
SET "name" = regexp_replace(btrim("name"), '\s+', ' ', 'g');

UPDATE "workflow_instances"
SET "name" = 'Instance #' || "instance_number"
WHERE "name" = '';

DROP TABLE IF EXISTS _wf_names;
CREATE TEMP TABLE _wf_names (
  tpl TEXT NOT NULL,
  key TEXT NOT NULL,
  PRIMARY KEY (tpl, key)
);

DO $$
DECLARE
  r    RECORD;
  cand TEXT;
  k    INTEGER;
BEGIN
  FOR r IN
    SELECT "id", "workflow_template_id" AS tpl, "name"
    FROM "workflow_instances"
    ORDER BY "workflow_template_id", "started_at", "created_at", "id"
  LOOP
    cand := r."name";
    k := 1;
    WHILE EXISTS (SELECT 1 FROM _wf_names WHERE tpl = r.tpl AND key = lower(cand)) LOOP
      k := k + 1;
      cand := r."name" || ' (' || k || ')';
    END LOOP;
    INSERT INTO _wf_names (tpl, key) VALUES (r.tpl, lower(cand));
    UPDATE "workflow_instances" SET "name" = cand, "name_key" = lower(cand) WHERE "id" = r."id";
  END LOOP;
END $$;

DROP TABLE IF EXISTS _wf_names;

ALTER TABLE "workflow_instances" ALTER COLUMN "instance_number" SET NOT NULL;
ALTER TABLE "workflow_instances" ALTER COLUMN "name_key" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_instances_workflow_template_id_instance_number_key"
  ON "workflow_instances" ("workflow_template_id", "instance_number");
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_instances_workflow_template_id_name_key_key"
  ON "workflow_instances" ("workflow_template_id", "name_key");

-- ── Instance notes ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "workflow_instance_notes" (
  "id"                   TEXT NOT NULL,
  "organization_id"      TEXT NOT NULL,
  "workflow_instance_id" TEXT NOT NULL,
  "author_user_id"       TEXT NOT NULL,
  "body"                 TEXT NOT NULL,
  "for_instance_step_id" TEXT,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"           TIMESTAMP(3),
  CONSTRAINT "workflow_instance_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "workflow_instance_notes_workflow_instance_id_created_at_idx"
  ON "workflow_instance_notes" ("workflow_instance_id", "created_at");
CREATE INDEX IF NOT EXISTS "workflow_instance_notes_for_instance_step_id_idx"
  ON "workflow_instance_notes" ("for_instance_step_id");
CREATE INDEX IF NOT EXISTS "workflow_instance_notes_organization_id_idx"
  ON "workflow_instance_notes" ("organization_id");

ALTER TABLE "workflow_instance_notes"
  ADD CONSTRAINT "workflow_instance_notes_workflow_instance_id_fkey"
  FOREIGN KEY ("workflow_instance_id") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
