# Task Tags — feature plan

**Written:** 1 Oct 2026
**Status:** Revived on 4 Oct 2026 after the client confirmed they need tags (it was briefly shelved on 1 Oct). Section 8 lists the decisions the client should confirm. Each one already has a default, so the build is not blocked on them.
**Reads with:** `backend/AUTHORIZATION.md`, `DESIGN_RULES.md`, and the frontend kit rules (`D:\RGB_Software\Kits\frontend-kit\FRONTEND_RULES.md`).

---

## 1. What we are building

Tags are org-wide labels with a colour. A task can carry several of them, for example `Client-ABC`, `Audit`, `Q4`, `Blocked-on-vendor`.

Tags are **not** a second category.

| | Category (exists) | Tag (new) |
|---|---|---|
| Per task | 0 or 1 | 0 to 10 |
| Purpose | The kind of work. Used to group reports. | A cross-cutting label used to find and slice work. |
| Who defines it | Work Settings | Anyone tagging a task can create one on the spot. Work Settings is where tags are cleaned up (option C, §3). |
| Reporting | `by_category` breakdown | `by_tag` breakdown (Phase 5). One task can count in several tags. |

Users can:

- Add and remove tags on a task when creating it, editing it, or from the detail page and the drawer.
- See tags on every task row, card and table.
- Filter every task list by one or more tags. Search also matches tag names.
- Add or remove a tag on many tasks at once from the bulk action bar.
- Have tags carried from a recurring template onto every spawned instance.
- Import tags from Excel and export them to CSV.
- Create a new tag on the spot while tagging a task. No admin setup is needed first.
- Clean up the tag list in Work Settings → Tags: rename, recolour, deactivate, reactivate and merge duplicates.

---

## 2. Data model

```prisma
model TaskTag {
  id                 String   @id @default(uuid())
  organization_id    String
  name               String              // display form, trimmed, max 40
  name_key           String              // lower(trim(name)), used for uniqueness and import matching
  color              String   @default("slate") // palette KEY, not a hex (see §6.1)
  description        String?
  is_active          Boolean  @default(true)
  created_by_user_id String
  created_at         DateTime @default(now())
  updated_at         DateTime @updatedAt

  tasks TaskTagLink[]

  @@unique([organization_id, name_key])
  @@index([organization_id, is_active])
  @@map("task_tags")
}

model TaskTagLink {
  id                 String   @id @default(uuid())
  organization_id    String
  task_id            String
  tag_id             String
  created_by_user_id String
  created_at         DateTime @default(now())

  task Task    @relation(fields: [task_id], references: [id], onDelete: Cascade)
  tag  TaskTag @relation(fields: [tag_id], references: [id], onDelete: Restrict)

  @@unique([task_id, tag_id])
  @@index([tag_id])
  @@index([organization_id])
  @@map("task_tag_links")
}
```

`Task` gets `tags TaskTagLink[]`. `RecurringTemplate` gets `tag_ids String[] @default([])`.

**Why it is built this way**

- **A join table, not a JSON array on the task.** Filtering ("tasks with tag X") must be an indexed join. Renaming a tag must reach every task without rewriting rows.
- **`onDelete: Cascade` on the task side.** Import undo and the create rollbacks hard-delete tasks (`task-import.service.ts:378`, `tasks.service.ts:848/871`). Their links must go with them.
- **`onDelete: Restrict` on the tag side.** A tag in use is deactivated, never deleted (kit §15.2). Only a tag that has never been used can be hard-deleted.
- **`name_key` is unique per org.** Categories have no uniqueness, which makes the import's match-by-name ambiguous (the last duplicate wins). Tags must not repeat that.
- **`RecurringTemplate.tag_ids` is a string array.** This matches how templates already store `assignee_user_ids` and `cc_user_ids`. The spawn step re-validates the ids and drops any tag that has since been deactivated.
- **Migration:** `backend/prisma/migrations/20261004120000_task_tags/`. The schema change is purely additive; the only data step is the `tasks.tags.create` permission backfill described in §3.
- **Housekeeping:** add both tables to `prisma/clear-tasks.ts` `TASK_TABLES`, before `tasks`. Register `TaskTag` in `src/audit/auditable-models.ts` next to `TaskCategory`, in the Tasks group.

---

## 3. Permissions — option C: create while tagging, curate in the master

**Decided 4 Oct 2026.** Tags are created on the spot by whoever is tagging a task. Work Settings → Tags exists to clean up the list, not as a setup step before tags can be used. Admins can turn on-the-spot creation off for any role.

Add two leaves to `access-rights/permission-registry.ts`:

```ts
// under tasks.management
feature('tasks.tags.create', 'Create task tags', [PermissionAction.write], 'Create a new tag while tagging a task')
// under tasks.configuration
feature('tasks.config.tags.manage', 'Manage task tags', A_MANAGE, 'Rename, recolour, deactivate, delete and merge task tags')
```

| Action | Who can do it |
|---|---|
| See the tag list (for the picker and filters) | Any org member. Same as categories today. |
| Create a new tag (from the task picker or the master page) | `tasks.tags.create` write **or** `tasks.config.tags.manage` write. Admins pass automatically. **Granted by default to every role that can create or edit tasks.** |
| Rename, recolour, deactivate, delete or merge a tag | `tasks.config.tags.manage` (edit / delete). Admins pass automatically. No default role gets it. |
| Add or remove existing tags on a task | Anyone who may edit that task. This goes through the existing `updateTask` gates, so there is no new rule. |
| Bulk tag | The existing `bulkUpdate` per-task scope and edit check. Tasks the user cannot edit are skipped and the reason is reported. |

**Default grants**

- **New orgs.** Add `{ feature_key: 'tasks.tags.create', actions: [write] }` to `WORK_CONTENT_GRANTS` in `default-system-roles.ts`. The Employee, Manager and other default roles then get it.
- **Existing orgs.** The migration backfills a `RolePermission(feature_key='tasks.tags.create', action='write', allowed=true)` row for every role that currently holds `tasks.task.manage` write. Anyone who can create a task can create a tag on day one.
- **Restricting it.** An admin removes `tasks.tags.create` from a role in Access Control. That role then sees **Create tag "xyz"** greyed out in the picker, with the tooltip "Only people allowed to create task tags can do this." (kit §26.2 wording), and must pick from existing tags. That is option A for that role, with no code change.

**Create route gate.** `POST masters/tags` takes two keys, so it cannot use a single `@RequirePermission`. The service checks `hasEffective('tasks.tags.create','write') || hasEffective('tasks.config.tags.manage','write')`. Tags are org configuration, not participant rows, so this action check plus the org filter is the complete gate. AUTHORIZATION.md rule 6 concerns row-scoped content and does not apply here.

**Keeping the list clean without blocking anyone**

- **Exact repeats.** Names are unique ignoring case and surrounding spaces. Typing "audit" when "Audit" exists selects "Audit"; it never creates a second one.
- **Near-matches.** The picker lists existing matches above the **Create tag "…"** row, using contains-matching ("urgent" also shows "Urgent review"). The create row only appears when no exact match exists.
- **Cleanup.** The master page shows each tag's usage count and creator, and sorts by "Least used" so stray one-off tags stand out. Admins merge or deactivate them there.
- **Bad input.** `POST masters/tags` is rate-limited to 30 per user per hour as a guard against runaway scripts and paste accidents. Names are capped at 40 characters, and pipes and commas are rejected.

**Authorization checklist (from `AUTHORIZATION.md`)**

- Every `/masters/tags/:id` route does `findFirst({ id, organization_id })` and returns 404 on a miss. No route uses a bare `where: { id }`.
- Tag master data is org configuration, not participant content. It needs the action gate plus the org filter; no scope leaf is required. Usage counts go only to holders of the manage permission.
- Task-tag mutation goes only through `createTask`, `updateTask` and `bulkUpdate`. Those already gate the task object. **There is no standalone `POST /tasks/:id/tags` route**, so there is no new IDOR surface.
- Every `tag_id` supplied by a client is validated as belonging to the caller's org. A tag id from another org returns 400.
- The tag filter on list routes is ANDed with the existing `listWhere` scope. Filtering cannot reveal tasks the user could not already see.

---

## 4. Backend

### 4.1 Tag master CRUD — `src/task-masters/`

| Route | Gate | Notes |
|---|---|---|
| `GET  masters/tags?include_inactive=` | none | Sorted by name. Includes `usage_count` and creator only for holders of the manage permission. |
| `POST masters/tags` | `tasks.tags.create` write OR `tags.manage` write (service-level, §3) | Used by both the task picker and the master page. When `name_key` matches an **active** tag, it returns that tag with `200` instead of an error, so two people creating "Audit" at the same moment both end up with the same tag. When it matches an **inactive** tag, it returns 409 "'Audit' exists but is deactivated"; only a manage-holder can then reactivate it. |
| `PATCH masters/tags/:id` | `tags.manage` edit | Uses a **real partial `UpdateTagDto`**, unlike categories, whose PATCH reuses the Create DTO and therefore requires `name`. |
| `DELETE masters/tags/:id` | `tags.manage` delete | Hard-deletes when `usage_count = 0`; otherwise sets `is_active = false`. The response says which happened. |
| `POST masters/tags/:id/merge` `{ into_tag_id }` | `tags.manage` edit + delete | In one transaction: re-point the links (skipping duplicates), rewrite the `tag_ids` of affected templates, then delete the source tag. This is how duplicates such as "urgent" and "Urgent!" get cleaned up. |

DTO validation:

- `name` is 1–40 characters after trimming. Commas and pipes are rejected, because `|` is the import delimiter.
- `color` must be a known palette key (`@IsIn(TAG_COLORS)`).
- `description` is at most 200 characters.

### 4.2 Shared validator — `src/common/task-masters-usable.ts`

Add `assertTagsUsable(prisma, orgId, tagIds, { keep?: string[] })`:

- Deduplicate the ids and enforce a maximum of 10.
- `count({ id: { in }, organization_id, is_active: true })` must equal the number of **newly added** ids.
- Ids in `keep` (tags already on the task) may be inactive. A task that carries a since-deactivated tag can still be saved.

Tasks, recurring templates, bulk actions and import all use this one validator.

### 4.3 Tasks — `src/tasks/`

- **DTOs.** Add `tag_ids?: string[]` to Create and Update (`@IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(10)`). On update it is the full authoritative list, the same rule as `assignee_user_ids`. Omitting it means "unchanged". Sending `[]` means "clear all".
- **`createTask`.** Validate, then `taskTagLink.createMany` alongside the other child rows. It is already covered by the existing rollback, because the links cascade.
- **`updateTask`.** Reconcile with diff → `deleteMany` the removed links and `createMany` the added ones. Record `{ field: 'tags', from: [names], to: [names] }` in `changedFields`. This reuses the existing `edited` activity entry, so the `TaskActionType` enum needs no migration.
- **`TASK_INCLUDE`.** Add `tags: { select: { tag: { select: { id, name, color, is_active } } }, orderBy: { tag: { name: 'asc' } } }`. That covers list, paged, detail, export, my/cc/assigned/escalated and the archive snapshot. These read paths need it added by hand:
  - `getReports` (`:3909`)
  - `getCollectiveTasks` (`:4253`)
  - recurring `getInstances` (`recurring-tasks.service.ts:966`)
  - `workflow-template.service.ts:308`
- **Response shape.** Flatten to `tags: { id, name, color, is_active }[]` on the way out, so the frontend never sees the join row.
- **Filtering.**
  - Add `tag_ids` (CSV) to `TaskListFilters` and to every route that accepts `category_id`: `/`, `/paged`, `/dashboard`, `/flow`, `/people-tree`, `/export`.
  - In `buildTaskWhere`, push the condition into `where.AND` so it cannot overwrite the existing `OR` (search) or `assignees` filters: `{ tags: { some: { tag_id: { in: ids } } } }`.
  - Matching is "any of": a task matches if it carries any selected tag. "All of" is deferred (§8 Q5).
- **Search.** Extend the `search` OR clause with `{ tags: { some: { tag: { name: { contains, mode: 'insensitive' } } } } }`.
- **Bulk.** `bulkUpdate` gets `action: 'add_tags' | 'remove_tags'` with `tag_ids`. It runs the same per-task skip-and-report loop and writes one activity entry per changed task.
- **Export.** Add a `Tags` column, joined with ` | `.

### 4.4 Recurring templates and spawning

- Add `tag_ids` to the recurring create and update DTOs and validate it with `assertTagsUsable`. Add a `tag_ids` filter to the template list.
- **Spawning.** `scheduler.service.ts` `spawnEntry` (`:256`), after the task create at `:315`: load the active tags among `template.tag_ids` and `createMany` the links. A deactivated tag is skipped silently. It does not stop the spawn.
- Editing a template's tags affects **future** spawns only. That matches how category behaves today. Open instances are not rewritten.

### 4.5 Import — `task-import.service.ts`

- **Column.** Add an optional `tags` column. Cells are pipe- or newline-separated and reuse `splitList`.
- **Matching.** Match on `name_key` using a `tagByKey` map in `loadContext`. An unknown tag produces the row error `Tag "X" not found`. Importing never creates tags, so a bad sheet cannot create junk tags.
- **Options.** `getImportOptions` returns the active tags, which feed the Excel "Tags" sheet.

### 4.6 Out of scope for v1 (noted so it is not forgotten)

- **Tags on workflow steps.** `WorkflowStep.category_id` is already stored without validation (`workflow-template.service.ts:136/159`). If tags are added to steps later, they must use `assertTagsUsable`.
- **Workflow triggers.** A trigger such as "when a task tagged X completes" is out of scope.

### 4.7 Tests

- `task-masters`: CRUD, case-insensitive uniqueness, delete-vs-deactivate, merge (including the case where both tags are already on the same task), and cross-org ids returning 404.
- `tasks.service`: create and update with tags, clearing tags, an inactive tag kept on the task versus a newly added one, a foreign-org tag id returning 400, the tag filter combined with search and with the assignee filter, and the activity log diff.
- Bulk add and remove with a mix of editable and non-editable tasks.
- Scheduler spawn copies active tags and skips deactivated ones.
- Import: a known tag, an unknown tag, and multiple tags in one cell.

---

## 5. Frontend

### 5.1 Shared pieces (built once, used everywhere)

Kit §4 rule 2 is "define once". The chip markup is already copied six times, so tags start as shared components:

| Component | Where | What |
|---|---|---|
| `TagChip` | `components/ui/TagChip.tsx` | Takes `{ name, color, onRemove? }`. Colour comes from palette **classes** backed by tokens in `globals.css`, not inline `style` (kit §1 rule 2). Long names truncate with a tooltip (kit §8). An inactive tag renders muted with "(inactive)" in the tooltip. |
| `TagList` | `components/tasks/TagList.tsx` | Shows the first N chips plus a `+3` overflow chip that opens a popover with the rest. It is used on rows and cards to respect the kit §11.6 limit of five pieces of information per card. |
| `TagPicker` | Extend `components/ui/MultiSelect.tsx` | **Extend, do not fork** (kit §4.1). Add `renderChip` so selected values render as coloured `TagChip`s instead of the fixed blue chip. Add an optional `onCreate(query)` that shows a `Create tag "<query>"` row when nothing matches. The row appears only when no exact match exists. It is wrapped in a permission tooltip and is disabled for users without `tasks.tags.create` (or manage). While permissions are still loading it is disabled with no reason shown. Creating a tag selects it immediately; the server's 'return existing on exact match' makes double-creates harmless. Tick-box first column (kit §22). Searchable, with keyboard support (kit §16). |
| `PermissionTooltip` | `components/ui/PermissionTooltip.tsx` | Port it from the kit (`frontend-kit/components/ui/permission-tooltip.tsx`), since v2e has none. Every disabled tag action in this feature uses it. |
| API and types | `lib/api/tasks.ts`, `lib/types/tasks.ts` | `TaskTag` type; `getTags`, `createTag`, `updateTag`, `deleteTag`, `mergeTag`; `Task.tags`; `tag_ids` on `WorkQuery`, the create/update payloads and the recurring payloads. |

### 5.2 Where tags appear

**Create and edit**

- `CreateTaskModal` (one-time and recurring modes), `EditTaskModal` and `EditRecurringModal` get a full-width **Tags** field directly under the Category/Priority row, labelled above the field (kit §11.3).
- When tags are cleared, the form sends an explicit `tag_ids: []`. Do not copy the `category_id || undefined` pattern in `EditTaskModal`, which makes it impossible to clear a category.

**Task detail** (`[taskId]/page.tsx`)

- A Tags row in the Details card, under Category.
- People who can edit the task get an inline "+ Add tag" control, using `TagPicker` in a popover, and each chip gets a ✕. Tagging is a triage action, so it should not need the full Edit modal.
- People who cannot edit see read-only chips.
- The edit gate uses the real permission check, not the existing hard-coded `isCreator || user?.is_admin` at `:843`. Fixing that line for status edits is a separate ticket.

**Drawer** (`overview/TaskDrawer.tsx`): the same Tags row as the detail page.

**Lists**

- `TaskListRow`, `TaskRow`, `TaskCard` and the Kanban card show `TagList` with at most 2 chips plus overflow.
- `TaskTable` gets a **Tags** column with a header filter.
- `RecurringTable` and the recurring detail page show the template's tags.

**Filters (every task list)**

- **My / Assigned / CC / Escalated** (client-side): add `tagIds: string[]` to `TaskFilters`. Add a Tags section to `TaskFilterPopover` with counts, a chip in `TaskFilterChips`, matching in `applyTaskFilters`, and tag names in `matchesSearch` (kit §27.1: search covers tags).
- **Overview** (server-side): a Tags multi-select in the filter panel, an active-filter pill, `tag_ids` in `baseFilters`, and a header filter in table view.
- **Recurring list:** a Tags section in `RecurringFilterToolbar`.

**Bulk** (`overview/BulkActionBar.tsx`): a **Tag** button opens a small panel with *Add tags* and *Remove tags*. The result toast says "Tagged 18 tasks · 2 skipped (no edit access)".

**Import** (`ImportTasksModal.tsx`): add a `tags` column to the template, a "Tags" sheet with the valid names, the rule text "Pipe-separated; must match an existing tag", and a header label.

### 5.3 Work Settings → Tags tab (`app/dashboard/tasks/masters/page.tsx`)

- **Gating.** Add `tags: 'tasks.config.tags.manage'` to `TASK_TAB_LEAF`. Users without the permission do not see the tab at all (kit §26: whole areas are hidden).
- **List.** Each tag shows as a chip preview, followed by its description, usage count ("Used on 42 tasks", which links to the overview filtered by that tag) and an Active/Inactive badge. Below the list is a "Show inactive" control.
- **Create and Edit.** One form with fields for name, a colour swatch grid (palette keys, not a free hex picker) and description. Per kit §11.3 the same form serves both create and edit. Most tags will arrive from the task picker, so this page is mainly for cleanup.
- **Sort and columns.** Sort by Name, Most used or Least used. Show a "Created by" column so stray tags can be traced.
- **Row actions.**
  - **Deactivate** is the lead destructive action (kit §15.2). It opens `ConfirmDialog`: "Deactivate 'Audit'? It stays on 42 existing tasks but can't be added to new ones."
  - **Delete** is offered only when the usage count is 0. Otherwise it is disabled, with a `PermissionTooltip` explaining why (kit §15.1).
  - **Reactivate.**
  - **Merge into…** asks for a target tag and opens a `ConfirmDialog` that names both tags and the number of tasks affected.
- **No native dialogs.** No `window.confirm`; the categories tab currently uses one at `:176`, and that must not be copied.
- **Empty states** (kit §13):
  - Nothing yet: "No tags yet · Tags let you label tasks across categories · [Create tag]".
  - Search matched nothing: "No tags match 'xyz' · [Clear search]".

### 5.4 States

- **Picker loading:** a skeleton, not a spinner (kit §14).
- **Picker load fails:** the field shows an inline "Couldn't load tags · Retry". The rest of the form still works.
- **Create collides with an existing tag:** inline "A tag named X already exists". If the existing tag is inactive, also offer "Reactivate it".
- **Adding the 11th tag:** the picker disables further options with the hint "Up to 10 tags per task".

---

## 6. Design decisions

### 6.1 Colour: a fixed palette, not free hex

Categories use free hex with `<input type="color">` and inline `style={{background: color+'22'}}`. Tags will not, for three reasons:

1. **Inline colour is not allowed.** Kit §1 rule 2 forbids inline colour styles, and migration-plan self-check #1 is "no colour outside globals.css".
2. **Contrast.** Free hex values regularly produce unreadable chips, such as yellow text on a pale yellow fill (kit §2.3 and DESIGN_RULES "Contrast").
3. **Open question Q6.** The migration plan still has Q6 open (data-driven colour with no carve-out). A fixed palette of token keys answers Q6 for tags without waiting on it.

The palette has eight keys: `slate`, `ochre`, `indigo`, `rose`, `teal`, `green`, `violet` and `amber`. They are seeded from the kit §21 categorical colours. Each key gets a fill, a text and a border token in `globals.css`, checked for contrast. The DB stores the key, so a later re-theme changes every tag at once.

### 6.2 Smart defaults over toggles

- **Filter matching** is always "any of the selected tags". There is no toggle in v1.
- **Default colour for a new inline tag** is the next palette colour in rotation, so a quickly created tag is never grey by default.
- **Filter persistence.** Kit §27.3 requires filters to survive opening a task and coming back. The My/Assigned/CC/Escalated pages already do this with `useSessionState`. The Overview page does not, because its filters are plain `useState`; it is fixed in Phase 3 since tags add another filter there.

---

## 7. Phases

Each phase is shippable on its own and ends with a green `next build` and green backend tests.

| Phase | Scope | Size |
|---|---|---|
| **1. Backend foundation** | Schema and migration; permission leaf; tag CRUD, delete-or-deactivate and merge; `assertTagsUsable`; `tag_ids` on task create and update; `TASK_INCLUDE` and the four hand-built read paths; activity diff; audit registration; `clear-tasks`; tests. | M |
| **2. Manage and apply** | `TagChip`, `TagList`, `TagPicker` (extending MultiSelect), `PermissionTooltip` port; palette tokens; Work Settings Tags tab; Tags field in Create and Edit; inline tags on the detail page and drawer. | M |
| **3. See and find** | Chips on rows, cards, Kanban and table; tag filter and search, server-side (overview, export) and client-side (My/Assigned/CC/Escalated); Overview filter persistence. | M |
| **4. Scale** | Bulk add and remove; recurring template tags and spawn copy; import column and Excel sheet; CSV export column. | M |
| **5. Report** | `by_tag` breakdown in `tasks-analytics` (a groupBy on `task_tag_links` joined to the task where-clause), plus a chart click-through to the filtered list. | S |

Phases 1–3 are the minimum the client can start using. Phases 4–5 can follow in the next release.

---

## 8. Decisions to confirm with the client

Each has a default, and the build proceeds on the default unless the client says otherwise.

| # | Question | Default |
|---|---|---|
| Q1 | Who can **create** new tags? | **Decided (option C):** anyone who can create or edit tasks can create one while tagging. Admins clean up in Work Settings and can restrict creation per role. |
| Q2 | Are tags shared across the whole org, or can a person have private tags? | **Org-wide only.** |
| Q3 | Should a tag be restrictable to certain departments, as categories can be (`visible_to_departments`)? | **No in v1.** It can be added later without a migration break. |
| Q4 | What is the maximum number of tags per task? | **10.** |
| Q5 | Does the client need "show tasks having **all** of these tags" as well as "any"? | **Any only in v1.** The backend can add `tag_match=all` cheaply if asked. |
| Q6 | Should the tag picker appear on tickets or projects too? | **Tasks only.** The models are task-specific (`TaskTag`). |

---

## 9. Found during the survey (not in this scope, but do not copy these patterns)

- `EditTaskModal` sends `category_id: categoryId || undefined`, so a category can never be cleared.
- The category and priority PATCH routes reuse the Create DTO, which forces `name` and `label` on every partial update.
- `masters/page.tsx:176` uses `window.confirm` to delete a category, and never offers Deactivate.
- `[taskId]/page.tsx:843` gates editing on a hard-coded `user?.is_admin`.
- `workflow-template.service.ts:136/159` stores `category_id` without an org or active check.
- The global instructions point to `D:\RGB_Software\rgb-kit-v2\AGENTS.md`, which no longer exists. The kit now lives at `D:\RGB_Software\Kits\frontend-kit\FRONTEND_RULES.md`.

---

## 10. Build contract (fixed 4 Oct 2026, so backend and frontend can be built in parallel)

The frontend codes against this contract and the backend implements it exactly. Anyone who needs to deviate must record the change here.

### 10.1 Shapes

```ts
type TagColor = 'slate' | 'ochre' | 'indigo' | 'rose' | 'teal' | 'green' | 'violet' | 'amber';

// Light reference embedded in tasks and templates
interface TaskTagRef { id: string; name: string; color: TagColor; is_active: boolean }

// Master row (GET masters/tags)
interface TaskTag extends TaskTagRef {
  organization_id: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  // Present ONLY when the caller holds tasks.config.tags.manage (any action) or is admin:
  usage_count?: number;
  created_by?: { id: string; name: string } | null;
}
```

- **Task responses.** Every response that carries a task (list, paged, my/cc/assigned/escalated, detail, drawer, create/update results, collective, reports, recurring instances) includes `tags: TaskTagRef[]`, sorted by name. The join row is never exposed.
- **Recurring template responses** include `tag_ids: string[]` and `tags: TaskTagRef[]`, resolved and sorted by name. Unknown ids are dropped.

### 10.2 Endpoints (base `/api/v1/org/:orgId/tasks`)

| Method and path | Body / query | Returns |
|---|---|---|
| `GET masters/tags` | `?include_inactive=true` (default: active only) | `TaskTag[]` sorted by name |
| `POST masters/tags` | `{ name, color?, description? }` | `201 TaskTag` when created. `200 TaskTag` when an active tag with the same name already exists; the frontend treats both the same. `409` when the name matches an inactive tag; the body's `message` is "'X' exists but is deactivated" and it carries `tag_id`. `429` when the rate limit is hit. `403` when the caller lacks both `tasks.tags.create` and `tasks.config.tags.manage`. When `color` is omitted, the server picks the least-used palette colour in the org. |
| `PATCH masters/tags/:id` | `{ name?, color?, description?, is_active? }` (all optional) | `TaskTag`. `409` on a name collision. |
| `DELETE masters/tags/:id` | — | `{ result: 'deleted' \| 'deactivated' }` |
| `POST masters/tags/:id/merge` | `{ into_tag_id }` | `{ moved: number, into: TaskTag }` |
| `POST /` (create task), `PATCH /:id` | `tag_ids?: string[]` (max 10; on PATCH, omitted means unchanged and `[]` clears) | task with `tags` |
| `POST recurring` / `PATCH recurring/:id` | `tag_ids?: string[]` | template with `tag_ids` and `tags` |
| `GET /`, `/paged`, `/dashboard`, `/flow`, `/people-tree`, `/export`, `GET recurring` | `tag_ids=<csv>` (matches any) | filtered as usual |
| `POST bulk` | `{ task_ids, action: 'add_tags' \| 'remove_tags', tag_ids }` | the existing bulk result shape (updated count plus skipped with reasons) |
| `GET dashboard` | — | adds `by_tag: { id, label, color, total, timing }[]`, the same item shape as `by_category` |
| Import options and validate | `tags` column, pipe- or newline-separated | `TaskImportOptions.tags: { id, name }[]`; resolved row gets `tag_ids: string[]`; an unknown tag produces the row error `Tag "X" not found` |
| CSV export | — | a `Tags` column, joined with ` \| ` |

### 10.3 Permission keys (frontend `can(key, action)`)

- `tasks.tags.create` + `write`: may create tags (the picker's create row, and the Create button on the master page).
- `tasks.config.tags.manage` + `write` / `edit` / `delete`: the Work Settings Tags tab, rename/recolour/deactivate (`edit`), delete (`delete`), and merge (needs both `edit` and `delete`).
- Admins pass every check.

### 10.4 Shared frontend pieces (built in wave 1; everyone else imports them)

| Import | API |
|---|---|
| `@/lib/types/tasks` | `TagColor`, `TaskTagRef`, `TaskTag`, `TAG_COLORS: TagColor[]`; `Task.tags?: TaskTagRef[]`; `tag_ids` on the create/update/recurring payloads and on `WorkQuery` |
| `@/lib/api/tasks` | `tasksApi.getTags(orgId, { includeInactive? })`, `createTag(orgId, body)`, `updateTag(orgId, id, body)`, `deleteTag(orgId, id)`, `mergeTag(orgId, id, intoId)` |
| `@/lib/tasks/useTaskTags` | `useTaskTags(orgId, { includeInactive? })` returns `{ tags, loading, error, reload, createTag(name) }`. The list is cached per org at module level so every picker shares one fetch. `createTag` inserts the result into the cache. |
| `@/components/ui/TagChip` | `<TagChip tag={TaskTagRef} size?="sm"\|"md" onRemove?={() => void} />`. Colour comes from palette classes or tokens, never inline style. Long names truncate with a tooltip. Inactive tags render muted. |
| `@/components/tasks/TagList` | `<TagList tags={TaskTagRef[]} max?={2} />`. Shows the first `max` chips plus a `+N` chip that opens a popover with the rest. |
| `@/components/tasks/TagPicker` | `<TagPicker orgId value={string[]} onChange={(ids) => void} max?={10} disabled? placeholder? />`. Built on the extended `MultiSelect`. It owns the create row, the permission tooltip, loading and error states, and the max limit. |
| `@/components/ui/PermissionTooltip` | `<PermissionTooltip allowed={boolean \| undefined} reason="Only someone who … can …">{control}</PermissionTooltip>`. `undefined` means the permission check is still loading: the control is disabled and no reason is shown. |

#### 10.4.1 As built (wave 1, 4 Oct 2026) — additions to the contract above

Everything in the table above exists with those names, paths and props. Every component is both a named and a default export. The additions below are optional supersets; nothing above changed meaning.

- **Types** (`@/lib/types/tasks`): also `MAX_TAGS_PER_TASK` (10), `CreateTagInput`, `UpdateTagInput`, `DeleteTagResult`, `MergeTagResult`, `CreateTaskInput` (now the `createTask` body, with `tag_ids`), `UpdateTaskInput` (`Partial<Task> & { tag_ids?: string[] }`, the `updateTask` body), `BulkUpdatePayload` (adds `tag_ids`) and `BulkUpdateResult` (`{ updated, skipped?: { id, title, reason }[] }`). `BulkAction` gains `'add_tags' | 'remove_tags'`. `WorkQuery.tag_ids` and `RecurringListQuery.tag_ids` are typed `string[] | string`; both are sent as `tag_ids=a,b` and an empty list is dropped. `TaskDashboard.by_tag` is **optional** until Phase 5 ships. `RecurringTemplate` has `tag_ids?` and `tags?`.
- **API errors** (`@/lib/api/tasks`): `createTag` turns a 409 into a thrown `TagConflictError` (`message` = the server's "'X' exists but is deactivated", `tagId` = the existing tag's id, read from the body's top-level `tag_id`). Check it with `isTagConflictError(e)`. Every other failure (400/403/429) is the original AxiosError; `tagErrorMessage(e, fallback?)` reads the server message from either. `getTags` has a 15 s timeout (kit §14.4).
- **Cache helpers** (`@/lib/tasks/useTaskTags`): `upsertCachedTag(orgId, tag)`, `removeCachedTag(orgId, tagId)` and `invalidateTaskTags(orgId)`. **The Work Settings → Tags page must call these** after a rename/recolour/(re)activate, a delete and a merge respectively, or open pickers keep the stale list.
- **Cache freshness (review fix, 4 Oct 2026).** The shared list is stale-while-revalidate: a cached list older than 60 s is still served at once, and a hook that mounts refetches it in the background and swaps it in place (no skeleton; a failed background refresh keeps the list silently). `useTaskTags(orgId, { includeInactive?, ensureIds? })`: `ensureIds` (a field's value, the URL's filter) refetches **once per id** when the loaded list lacks one (a tag someone else created since); an id still missing afterwards is not retried. The hook also returns `resolving` (true while such a refetch runs — show "…", not "unknown"). `reload()` keeps the current list on screen while it refetches. A generation counter guards the cache: `invalidateTaskTags` (and an upsert/remove while a request is in flight) makes that request's older result refetch instead of landing in the cache. `TagPicker`, `TagSelect` and the overview's filter pills pass `ensureIds`.
- **`TagPicker` `knownTags?: TaskTagRef[] | null`** (review fix): the record's own refs (`task.tags`, a template's `tags`). A selected id the org list can't resolve still gets its chip, named from these, with a working ✕; with no ref either, it shows a muted "Unknown tag" chip ("…" while resolving), so an id can never sit invisibly in the value counting toward the limit. `EditTaskModal` passes `task.tags`, `EditRecurringModal` `template.tags`, `InlineTaskTags` the task's tags. `TagSelect` shows the same muted "Unknown tag" chip for an unresolvable selected id (e.g. a stale `?tag_ids=` link), and gained `maxSelected?` / `maxSelectedHint?` (passed to `MultiSelect`).
- **`tasksApi.createTagDetailed(orgId, body)`** → `{ tag, created }` (`created` = HTTP 201). `createTag` is now a thin wrapper over it (unchanged signature). The Tags tab uses it: when create answers with an existing active tag (200) the tab's list did not have, the form says "A tag named 'X' already exists", the tag goes into the shared cache, and the tab refetches its list quietly — it never labels that tag as created by the current user with 0 uses.
- **Colour classes** (`@/lib/tasks/tagColors`): `tagChipClass(color, inactive?)` (fill + text + border; pair with a `border` width class), `tagDotClass(color, inactive?)` (full-strength swatch/dot), `normalizeTagColor()` and `TAG_COLOR_LABELS`. They return plain classes (`tag-chip-ochre`, `tag-dot-ochre`, `tag-chip-inactive`…) defined in `app/globals.css` outside any Tailwind layer, backed by `--tag-<key>-bg|text|border|dot` tokens. Never reach for the tokens directly.
- **`TagChip`**: also `className?`. **`TagList`**: `tags` also accepts `null`/`undefined` (renders nothing), plus `className?`. **`PermissionTooltip`**: also `className?` for the wrapper's layout (default `inline-flex`; the MultiSelect create row passes `flex w-full`). The kit's own component has no such prop; it exists because v2e rows are full width.
- **`TagPicker`**: reads the include-inactive list, so a selected tag that has since been deactivated still renders as a muted chip. It exports `CREATE_TAG_REASON`. Its default placeholder is "No tags".
- **`MultiSelect`** (extended, not forked): new optional props `renderChip(option, onRemove)`, `onCreate(query)`, `createLabel(query)`, `canCreate` (omitted = allowed; passed `undefined` = not known yet), `createDisabledReason`, `createInvalidReason(query)`, `maxSelected`, `maxSelectedHint`; options take `colorClassName` as the class-based alternative to `color`. Keyboard per kit §16.4 (arrows, Enter, Escape returning focus). The field is now a focusable `div role="button"` rather than a `<button>`, so chip ✕ controls are real buttons, and Enter in its search box no longer submits the surrounding form.
- **Work Settings → Tags** (`components/tasks/masters/TagsTab.tsx`, mounted by `masters/page.tsx` as `?section=tasks&tab=tags`). Its "Used on N tasks" link goes to `/dashboard/tasks?tag_ids=<id>`; the Overview page must read `tag_ids` (CSV) from the URL. `POST masters/tags` returns no `usage_count`/`created_by`, so the tab fills them locally for a tag it just created (0, the current user). The tab keeps its own `include_inactive=true` list (so usage counts are fresh on every visit) and pushes changes to the shared cache with `upsertCachedTag` / `removeCachedTag` / `invalidateTaskTags` (merge). Rows deactivated during a visit stay in view, with Reactivate, while "Show inactive" is off.
- **`Tooltip`** (`components/ui/Tooltip.tsx`) gained `openOnTap?` (tap opens it; a press elsewhere, Escape or scroll closes it). `PermissionTooltip` uses it so the reason reaches touch users (kit §19).
- **Wave 2 (forms, detail, drawer) — as built.**
  - **`InlineTaskTags`** (`components/tasks/InlineTaskTags.tsx`): `<InlineTaskTags orgId taskId tags canEdit onUpdated? className? />`, used by the detail page's Details card and the overview drawer. `canEdit === true`: md chips with ✕ plus a "+ Add tag" button that opens `TagPicker` in a portalled popover (its list opens straight away; closes on a press outside, Escape, scroll or resize). `false`: read-only chips ("No tags" when empty) and "+ Add tag" disabled inside `PermissionTooltip` ("Only people who can edit this task can change its tags."). `undefined`: chips with no ✕ and "+ Add tag" disabled with **no** reason (kit §26.1), so nothing moves when the answer lands. Every change saves at once with `updateTask({ tag_ids })`, optimistically; saves are serialised and only the latest wanted list is sent, so quick clicks never race. A refused save rolls back to the last saved list and toasts the server's message. `onUpdated` receives the saved task (its `tags` always set) after **every** successful save, including ones with a newer change still queued, so the parent never holds a stale list if a later save fails.
  - **`isListboxOpen()`** (exported from the same file): true while any `MultiSelect` list is open. `CreateTaskModal`, `EditTaskModal` and `EditRecurringModal` check it in their Escape handlers, so Escape in the Tags search closes only the list, not the form (and not the discard dialog).
  - **`useCanEditTask(task, config?)`** (`lib/tasks/useCanEditTask.ts`) returns `boolean | undefined` and is the gate for inline tags. It mirrors the backend's `updateTask` exactly as far as the browser can: future task → false; creator → true; admin → true; otherwise the org's `task_edit_roles` must include `employee`, the user must hold `tasks.task.manage` edit, and an `own` edit scope additionally requires being a working (non-CC) assignee. A `team` scope depends on the reporting line, which the browser does not have, so it is answered optimistically and the server's 403 is handled by the rollback above (kit §26.5). The org's task config is fetched once per org unless the caller passes it. The detail page's older `isCreator || user?.is_admin` gate for status/title is unchanged (separate ticket, §9).
  - **Forms.** `CreateTaskModal` sends `tag_ids` only when some are picked (both modes). `EditTaskModal` and `EditRecurringModal` send `tag_ids` only when the set changed from what the form opened with (order-insensitive); `[]` is sent when the user cleared them. An untouched list is omitted, so the save never reverts someone else's concurrent tag change or trips over a tag merged/deactivated meanwhile. `EditTaskModal` counts a tag change as unsaved (order-independent). `EditRecurringModal` seeds from the resolved `tags` when present (unknown ids already dropped), else `tag_ids`.
  - **Recurring detail page** shows every template tag as wrapping read-only `TagChip`s in its Details card (not `TagList` with overflow: a detail page has room, and the overflow is meant for rows and cards).
- **Personal lists and Recurring (wave 2, lists/filters).** `TaskFilters.tagIds` and `RecurringFilters.tagIds` (match ANY). Stored session filters are run through `normalizeTaskFilters()` / `normalizeRecurringFilters()` (exported next to each model) so objects saved before `tagIds` existed still load. The Tags filter section offers only the tags present on the records in view (`tagsOnTemplates()` for recurring; the union of `task.tags` in `TaskFilterPopover`), sorted by name and hidden when none; a stored tag id that is no longer in view is dropped when the panel opens. The active-filter chip is one grouped `Tags: A, B` / `Tags: N selected` chip, the same as Category. `taskListView.tsx` exports `ClearNarrowingButton`, the single nothing-found action (Clear search / Clear filters / both) used by My, Assigned, CC and Escalated.
- **Recurring search moved client-side.** The recurring page no longer sends `search` to `GET recurring` (the server's search covers title and description only). It filters the loaded, unpaginated set on title, description, category, tag names, creator, department and assignee names (kit §27.1). The server parameter still exists; nothing else changed in the contract.
- **Card budget.** Tags never replace the category pill. On `TaskListRow` and `TaskCard` (full-width list rows, not §11.6 card-view cards) they join priority and category as one classification cluster, capped by `TagList max={2}`. On the Kanban card the column is the status (kit §35.5), so title · urgency (quadrant + priority) · tags · one meta line (deadline + people) stays within five. `RecurringTable` has a Tags column showing `—` when empty, matching its sibling columns. Recurring *cards* do not show tags (already at the §11.6 budget); the table and detail page do.
- **Overview, bulk, import (wave 2).**
  - **Overview URL state.** The overview's filters, search, sort, view and scope live in the query string (`router.replace`, `scroll: false`) instead of plain `useState`: `view`, `scope`, `q`, `status_id`, `priority_id`, `category_id`, `tag_ids` (`a,b`), `department_id`, `type`, `timing`, `assignee_user_id`, `created_by_user_id`, `from`, `to` (YYYY-MM-DD), `sort`. Defaults are omitted. `view` defaults to **Table** when any filter is present and to Analytics otherwise, so `/dashboard/tasks?tag_ids=<id>` (the Work Settings "Used on N tasks" link) opens the matching tasks in the table. A URL change from outside (a link, Back/Forward, the sidebar's plain link) re-reads the state; the page's own replaces are recognised and skipped.
  - **`TagSelect`** (`components/tasks/overview/TagSelect.tsx`): pick existing tags only, no create row — the overview's Tags filter (panel and table header) and the bulk "Remove tags". `<TagSelect orgId value onChange pool? placeholder? emptyText? disabled? wrapperClassName? />`; offers active tags plus selected inactive ones, or exactly `pool`. `TagPicker` stays the form field (it can create).
  - **Table tag filter** is not a `TableFilterKey` (those are single-value selects); `TaskTable` takes `orgId`, `tagIds` and `onTagFilter(ids)` and writes the same page state as the panel. Pills: one removable `Tag: <name>` pill per selected tag.
  - **Bulk.** `BulkActionBar` takes `orgId`, `selectedTags` (union of the selected tasks' tags, for Remove) and `onTags(action, tagIds) => Promise<boolean>`. Add uses `TagPicker` (so a permitted user can create inline), Remove uses `TagSelect` over `selectedTags`, capped at 50 picks (the endpoint's limit; hint "Up to 50 tags at a time"). Toast: "Tagged N tasks · M already had them · K skipped (no edit access)", built from the response's `skipped[].reason` (grouped; the edit-access and 10-tag reasons are shortened). "M already had them" / "didn't have them" counts only selected tasks whose loaded `tags` show the action was a no-op for them; tasks the server dropped silently (deleted, out of scope) are not attributed, so the part is omitted when nothing is determinable. The list then refetches every loaded page and swaps rows in place (no loading state).
  - **By tag.** `TagSpreadChart` (`components/tasks/overview/TagSpreadChart.tsx`) renders `by_tag` as HTML bars coloured with `tagDotClass` (an SVG `fill` cannot take the tag tokens), top 8, with a note that a task counts under each of its tags. It renders nothing when `by_tag` is missing or all zero; when it shows, the chart grid becomes 2×2 (Org layout and `TeamView`). A click opens the SegmentDrawer with `tag_ids: [id]`.
  - **Import.** The `tags` column sits after `category` (27 columns, so the template's column letters now run to AA). The preview shows a row's resolved tags as chips under the title; names come from the shared tag list, then the backend's extra `resolved.tags` (display names — present in the backend DTO but not in the frontend `TaskImportResolved` type), then `options.tags`.

### 10.5 Backend wave 1 — as built (4 Oct 2026)

Additions and clarifications to 10.1–10.3. None changes a shape the frontend codes against.

- **Error bodies.** Every error goes through `GlobalExceptionFilter`, so the body is `{ success: false, data: null, message, meta: null, ...extra }`. The create 409 is `{ success: false, data: null, message: "'Audit' exists but is deactivated", meta: null, tag_id: "<id>" }`, so the frontend reads `error.response.data.tag_id`. This depends on the filter passing extra exception fields through, which is in the working tree at `backend/src/common/filters/http-exception.filter.ts` and must ship with tags.
- **409 `tag_id` dependency.** Both 409s (create and rename) carry `tag_id` only because of the `GlobalExceptionFilter` change in `backend/src/common/filters/http-exception.filter.ts`, which passes extra exception fields through. That change must ship with tags. Without it the field is dropped and the frontend falls back to matching the tag by name.
- **PATCH 409.** A rename that collides returns `message: "A tag named 'X' already exists"` and also carries the clashing `tag_id`.
- **Merge refusals.** Merging a tag into itself returns 400. Merging into a **deactivated** tag also returns 400 ("Reactivate 'X' before merging another tag into it"). A target in another org returns 404, the same as the source. `moved` counts the tasks re-pointed to the target; tasks that already carried both tags are not counted.
- **Delete.** The result is `deactivated` when the tag is on any task **or** in any recurring template's `tag_ids`. Only a tag that nothing references is hard-deleted. "Any task" here includes soft-deleted tasks. Their links are kept for the archive, and the FK is RESTRICT.
- **Usage count.** `usage_count` counts live tasks only (`task.is_deleted = false`). A tag that is only on deleted tasks therefore shows 0 and the frontend enables Delete. The DELETE then returns `{ result: 'deactivated' }`, which the frontend already handles with a toast. This is intended.
- **Merge race.** If a concurrent change hits the `(task_id, tag_id)` unique index during a merge (P2002), the whole merge transaction re-runs once from a fresh read. If it collides again the response is 409 "Tags changed while merging. Try again.".
- **Sorting.** "Sorted by name" is case-insensitive, using `name_key`. This applies to the master list and to `tags` on tasks.
- **Name normalisation.** Runs of internal whitespace collapse to one space in the stored display name as well as in `name_key`. `"Client   ABC"` is stored as `"Client ABC"`.
- **Rate limit.** The limit is 30 creations per user **per org** per rolling hour, counted from `task_tags.created_by_user_id`. Re-selecting an existing tag, which returns 200, never counts. The 429 `message` is "You've created 30 tags in the last hour. Pick an existing tag or try again later."
- **403 message.** "Only people allowed to create task tags can do this." (kit §26.2 wording). This is the same wording as the picker tooltip.
- **Backend helpers for wave 2.** All are in `backend/src/common/task-masters-usable.ts`: `assertTagsUsable`, `TASK_TAG_REF_SELECT`, `TAG_REF_FIELDS`, `flattenTags`, `toTagRefs`, `loadTagRefMap`, `tagRefsFor` and `TaskTagRef`. Palette and limits are in `backend/src/task-masters/task-tag.constants.ts`.
- **Tasks service (wave 2) — as built.** All in `backend/src/tasks/tasks.service.ts` / `tasks.controller.ts`; no shape the frontend codes against changed.
  - **Serializer.** `TASK_INCLUDE` spreads `TASK_TAG_REF_SELECT`; the module-level `withTagRefs()` flattens the join rows. It runs in exactly two places: `enrichTaskList` (list, paged, export, my / cc / assigned-by-me / escalated, collective) and `getTask` (detail, plus every create / update / action result, which all return `getTask`). The archive snapshot written by `deleteTask` stores the flat refs too.
  - **Bulk gate.** `add_tags` / `remove_tags` use exactly the rights a single `updateTask` uses (`assertAssignerRights`), not the bulk loop's "any working assignee" shortcut that status/deadline/complete use. The rule, for both paths:
    1. The task's creator, or an org admin, may always edit its tags.
    2. Anyone else needs **both** of these. First, the org's `task_edit_roles` must include `'employee'`; if it doesn't, only creators and admins can edit. Second, they need `tasks.task.manage` **edit** scope over at least one of the task's core participants: the creator or a non-CC assignee. With `org` scope that is every task. With `team` or `department` scope, one of those people must be inside the actor's visible set. With `own` scope the actor's set is only themselves, so they must be a non-CC assignee of the task.

    So an assignee who didn't create the task **can** retag it when the org's edit roles include `'employee'` and they hold edit scope, even if it is only `own`. They are skipped only when the edit roles exclude `'employee'` or they have no edit scope at all. The skip reason is "You do not have edit access to this task." Where §3's two rows disagree, this follows the `updateTask` row.
  - **Simulated future.** Bulk `add_tags` / `remove_tags` skip a task whose `created_at` is after the org clock (`ClockService.now`). The reason is the same message `updateTask` returns as a 403: "This task was created in a simulated future. To interact with it, please time-travel to this date or later." The other bulk actions are unchanged.
  - **Bulk result.** `updated` counts tasks whose tags actually changed. A task that already has every tag being added, or none of the tags being removed, is neither updated nor skipped. A task that would go over 10 tags is skipped with "A task can have at most 10 tags." An empty `tag_ids` returns 400 "Pick at least one tag.". `add_tags` validates with `assertTagsUsable`, so the tags must be active. `remove_tags` takes up to 50 ids, which only need to belong to the org, so a deactivated tag can be removed. More than 50 returns 400 "Pick at most 50 tags." Each changed task gets one `edited` activity entry, `{ bulk: true, changes: [{ field: 'tags', from, to }] }`, the same `changes` shape a single edit writes.
  - **Activity diff.** `{ field: 'tags', from: string[], to: string[] }` holds tag names sorted case-insensitively. It is logged only when the set of tags changes; re-sending the same tags in a different order writes nothing.
  - **Filter.** `tag_ids` is accepted as CSV or as a repeated query param. Blanks are ignored, duplicates are dropped, and the list is capped at 50 ids. It is pushed into `where.AND`. The routes that take it are `/`, `/paged`, `/dashboard`, `/flow`, `/people-tree` and `/export`, plus the `GET recurring` handler in `tasks.controller.ts`, which shadows the recurring controller's route and now passes `tag_ids` the same way. `/dashboard` uses the same `buildTaskWhere`, so the filter reaches every analytics query. The empty-scope dashboard returns `by_tag: []`.
  - **Reports.** `GET reports` adds `tag_breakdown: { id, label, color, is_active, total, completed, overdue }[]`, sorted by `total` descending. A task counts once under each of its tags.

#### 10.5.1 Backend wave 2 — recurring, spawn, import, analytics, workflow reads (4 Oct 2026)

Nothing below changes a shape in 10.1–10.2; the additions are supersets.

- **Recurring templates.** Every template response (list, create, update, pause, resume) carries `tag_ids` (as stored, de-duplicated) and `tags: TaskTagRef[]` (resolved in one query per list, sorted by name, unknown ids dropped). On update, tags already on the template may be inactive (`keep`); newly added ones must be active. `GET recurring?tag_ids=a,b` matches any (`hasSome`). Both handlers of that route (`RecurringTasksController.list` and the shadowing `TasksController.listRecurring`) parse the value with `common/tag-ids-query.ts` `parseTagIdsQuery`. It accepts CSV, a repeated param or a mix of both, ignores non-strings, de-duplicates and caps at 50. Editing a template's tags never touches already-spawned instances, even with `apply_to: future_and_open` (that option still moves only the roster).
- **Spawning.** Links are created right after the task, attributed to the template creator (the spawned task's `created_by`). Inactive, deleted or foreign ids are skipped; a failure while copying tags is logged and swallowed, so it never costs the instance. `spawnEntry` has no surrounding transaction, so this follows the same best-effort pattern as the attachment copy.
- **Migration backfill.** `20261004120000_task_tags` grants `tasks.tags.create` write to every role holding `tasks.task.manage` write. It also gives the same grant to every **user** with a `grant` override for `tasks.task.manage` write, inserted into `user_permission_overrides` with `effect = grant` and `scope = NULL`. Revoke overrides are not mirrored. Both inserts use `ON CONFLICT DO NOTHING`.
- **Import.** `TaskImportResolved` also carries `tags: string[]` (the matched display names, for the preview) next to `tag_ids`. Matching uses `tagNameKey`, so case and runs of whitespace are ignored. A deactivated tag reads as `Tag "X" not found`. More than 10 distinct tags is the row error `A task can have at most 10 tags (this row has N)`. `getImportOptions().tags` is sorted by `name_key`. Undo needs nothing extra: it hard-deletes tasks and `task_tag_links` cascade.
- **`by_tag`.** Built in `TasksAnalyticsService.tagBreakdown` (called from `dimensionBreakdowns`, so it reaches `GET dashboard` through the existing `...dims` spread and also appears in the employee report's `assignee_breakdowns`). Seven `task_tag_links` groupBys, one per timing bucket with the dashboard's task where-clause nested under `task`, plus one label lookup. Deactivated tags keep their label; a tag missing entirely falls back to `"Unknown tag"` / `slate`. Ties on `total` sort by label. The empty-scope early return in `tasks.service.ts getDashboard` must add `by_tag: []`.
- **Workflow instance tasks** (`GET workflows/:id/instances/:iid/tasks`) now return flat `tags` and are also scoped by `organization_id`.
