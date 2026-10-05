-- AlterTable
ALTER TABLE "recurring_templates" ADD COLUMN     "tag_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "task_tags" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_tag_links" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_tag_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_tags_organization_id_is_active_idx" ON "task_tags"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "task_tags_organization_id_name_key_key" ON "task_tags"("organization_id", "name_key");

-- CreateIndex
CREATE INDEX "task_tag_links_tag_id_idx" ON "task_tag_links"("tag_id");

-- CreateIndex
CREATE INDEX "task_tag_links_organization_id_idx" ON "task_tag_links"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_tag_links_task_id_tag_id_key" ON "task_tag_links"("task_id", "tag_id");

-- AddForeignKey
ALTER TABLE "task_tag_links" ADD CONSTRAINT "task_tag_links_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_tag_links" ADD CONSTRAINT "task_tag_links_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "task_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Data: on-the-spot tag creation for everyone who can already create tasks ──
-- Option C (TASK_TAGS_PLAN.md §3): tags are created while tagging, so any role
-- that holds `tasks.task.manage` write today also gets `tasks.tags.create` write.
-- New orgs get the same through WORK_CONTENT_GRANTS in default-system-roles.ts.
-- Admin roles (is_admin) bypass the matrix and need no row. Idempotent: an
-- existing decision for the leaf (allowed or explicitly denied) is left alone.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
INSERT INTO "role_permissions" ("id", "organization_id", "system_role_id", "feature_key", "action", "allowed", "created_at", "updated_at")
SELECT gen_random_uuid(), rp."organization_id", rp."system_role_id", 'tasks.tags.create', 'write'::"PermissionAction", true, now(), now()
FROM "role_permissions" rp
WHERE rp."feature_key" = 'tasks.task.manage'
  AND rp."action" = 'write'::"PermissionAction"
  AND rp."allowed" = true
ON CONFLICT ("organization_id", "system_role_id", "feature_key", "action") DO NOTHING;

-- Same for per-user overrides: a user GRANTED `tasks.task.manage` write by a
-- personal override (whose role lacks it) can create tasks today, so they get
-- `tasks.tags.create` write too. Revoke overrides are not mirrored (a revoke
-- on task creation should not become a revoke on tags — the role decides).
-- Scope stays NULL: the create leaf has no data scope. Idempotent: an existing
-- override for the leaf (grant or revoke) is left alone.
INSERT INTO "user_permission_overrides" ("id", "organization_id", "user_id", "feature_key", "action", "effect", "reason", "created_at", "updated_at")
SELECT gen_random_uuid(), upo."organization_id", upo."user_id", 'tasks.tags.create', 'write'::"PermissionAction", 'grant'::"OverrideEffect",
       'Backfilled with task tags: holds a tasks.task.manage write grant', now(), now()
FROM "user_permission_overrides" upo
WHERE upo."feature_key" = 'tasks.task.manage'
  AND upo."action" = 'write'::"PermissionAction"
  AND upo."effect" = 'grant'::"OverrideEffect"
ON CONFLICT ("organization_id", "user_id", "feature_key", "action") DO NOTHING;
