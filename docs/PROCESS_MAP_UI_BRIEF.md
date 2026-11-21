# Process Map — Canvas & Swimlanes Build Brief

Decisions from the UI/UX session. Build in two phases: Phase 1 declutters the
canvas (small, ship first); Phase 2 adds pools & swimlanes (the manager's ask).

Files referenced:
- `frontend/app/dashboard/process-hierarchy/[mapId]/page.tsx` — page shell, top bar, breadcrumb, ⋯ menu
- `frontend/components/process-hierarchy/ProcessCanvas.tsx` — the ReactFlow canvas + floating buttons
- `frontend/components/process-hierarchy/NodeDrawer.tsx` — the edit sidebar
- `frontend/components/process-hierarchy/layout.ts` — auto-layout (left-to-right)
- `frontend/components/process-hierarchy/nested-render.ts` — nested/band rendering

---

## PHASE 1 — Canvas declutter + navigation

### 1.1 Canvas buttons  (ProcessCanvas.tsx + [mapId]/page.tsx)
Today the canvas floats five buttons: Select · Show map · Auto-arrange · PNG · Add step.

- **Keep on canvas:** only **Add step** — solid blue, `+` icon, top-right. Edit mode only; hidden in View mode.
  Make it a **split button**: main part adds a **task** (fast common case); the **▾** picks the kind
  (Container / Decision / Subprocess / Start / End). Never force a task. This is the ONLY node-creation control.
- **Move into the ⋯ "More" menu** (top bar): **Auto-arrange**, **PNG export**. Both are occasional actions.
- **Delete the button, make automatic:** **Select** (see 1.2 — selection becomes part of the pointer model).
- **Delete the button, make automatic:** **Show map** — the minimap now auto-shows (see 1.4).

Result: Edit mode = one blue button on a clean map. View mode = completely empty, readable map.

### 1.2 Navigation model — Figma style on desktop, drag-pans on touch
Two separate models. The user never notices the switch; each feels native.

**Mouse / trackpad (Figma model — user's chosen style):**
- Drag empty space = **marquee select** (draw a box around steps). ReactFlow: `selectionOnDrag`.
- Scroll wheel = pan up/down. Shift+scroll = pan left/right. ReactFlow: `panOnScroll`.
- Ctrl/Cmd + scroll = zoom.
- Hold **Spacebar** + drag = pan (hand tool). Middle-mouse drag = pan.
- Click a step = select it. Shift-click = add to selection.
- **Show faint scrollbars** on the right + bottom edges (like Figma). This is the ONE visible pan
  affordance a non-technical mouse user can find without knowing a shortcut. Do not skip it.
  (ReactFlow has no native scrollbars — small custom overlay bound to viewport transform.)

**Touch (phone + tablet) — drag always pans:**
- One-finger drag = pan the map. Pinch = zoom.
- Tap a step = select / drill (per locked "single click drills" rule).
- Drag a step itself = move that step (tablet edit only).
- **No marquee select on touch** — one-finger drag is reserved for panning. Set `panOnDrag` true,
  `selectionOnDrag` false when a touch device is detected.

Split by device (locked: mobile = view+drill only; editing = desktop + tablet):
- **Phone (view only):** drag = pan, pinch = zoom, tap drillable = drill in, tap task = read-only detail.
- **Tablet (edit):** drag = pan, pinch = zoom, tap = select, drag step = move, pencil icon = edit sidebar
  (pencil must be ≥44px tap target).

### 1.3 Hint strip → gone, and empty-state buttons → gone
Remove the persistent "Click a step to edit it" box floating on the canvas.
Also remove the on-canvas empty-state buttons ("Add Start", "Add first step") and their helper line —
"Add first step" wrongly forces the first node to be a task, and a forced Start marker is BPMN pedantry.
- All node creation goes through the top-right **Add step** split button (see 1.1). No buttons on the canvas body.
- Empty level shows faint centered text ONLY: *"This map is empty. Add your first step with the + button, top right."*
  Optional subtle arrow curving toward the top-right Add step control. Text disappears once ≥1 step exists.
- (Optional) first-ever visit only: a 4-second auto-dismiss toast with the tip. Never sticky.

### 1.4 Minimap auto-shows  (ProcessCanvas.tsx)
- Remove the "Show map" toggle.
- Show ReactFlow `<MiniMap>` **only when the content is bigger than the viewport** (compare nodes'
  bounding box to the visible area). Small level → no minimap. Big level → it appears bottom-right.

### 1.5 Auto-arrange = needs an Undo
Auto-arrange moves every step at once and persists positions — it needs a safety net.
- On click: snapshot current `{id → position}` in memory BEFORE arranging.
- Run layout, persist via `bulkPosition` as today.
- Show a toast for ~7s: **"Arranged N steps.  Undo"**.
- **Undo** restores the snapshot on screen AND writes the old positions back via `bulkPosition`
  (must un-save, not just un-move — or a refresh brings the mess back).
- Do NOT use version snapshots for this — those are for approved milestones, not scratch undo.

---

## PHASE 2 — Pools & Swimlanes  (the manager's ask) — LOCKED MODEL

Decisions finalized with the user. This is a swimlane process editor: pools stacked
top-to-bottom, department lanes inside the Company pool, nodes snapped into their lane.

### Pools
- Three pools: **Customer**, **Company**, **Vendor**. Stacked bands, order Customer → Company → Vendor.
- **Company** pool has **lanes = departments**. **Customer / Vendor** are external: ONE band each,
  **no department picker, no lanes**.

### Lanes (only inside the Company pool)
- A lane == a department (uses the app's existing Department entity).
- **Two ways a lane is born, tracked by an `origin` flag (`manual` | `auto`):**
  - **Hand-made** (create an empty lane first) → persists even when empty.
  - **Auto** (created the moment a node is assigned that dept) → vanishes when its last node leaves.
- Consequence (a feature, not a bug): the only empty lanes ever visible are hand-made ones, so an
  empty lane always means "kept on purpose."
- New lane appends at the **bottom** of the Company pool. Drag-to-reorder = later, not v1.
- **Delete a lane:** empty → remove instantly; has nodes → ask "move these N steps to which lane?" first.
- When an auto lane vanishes, **Undo** restores it + the node move.

### Node ↔ lane assignment
- **Department is compulsory for every Company node** — a node cannot exist in the Company pool
  without a lane. Customer/Vendor nodes have no department. So "unassigned" can never happen.
- **Selecting or creating a node in a lane defaults its department to that lane** (or the pool, for
  Customer/Vendor).
- Change a node's department → it **moves** to that lane (auto-create the lane if missing; old auto
  lane vanishes if emptied). No "you'll be thrown out" warning — the lane IS the department, changing
  it just moves the node. (Single source of truth; no separate dept field fighting the lane.)
- No **container** kind on a swimlane page. **Sub-process** is allowed (a step that drills deeper).

### Connections
- **Within a pool → solid line** (sequence flow).
- **Crossing pools → dotted line** (message flow / annotation style). Auto-detected from the two
  endpoints' pools; not a manual toggle.
- **Routing: orthogonal — straight segments + 90° corners.** Revisit curves only if they look better.

### Rendering
- Each pool/lane is a labeled band with a vertical label on its left edge (like the sample image).
- **Horizontal** position of a step = existing left-to-right flow order (layout.ts). **Vertical**
  position = which lane/pool band it belongs to.

### NOT in v1 (tell the manager — it'll be "BPMN-lite", not a pixel copy of the sample)
- Parallel gateway (the `+` diamond — "do two in parallel, wait for both"). Only yes/no decisions exist.
- Message/intermediate events (the envelope circles).
- A lane being a single **person** (the sample's "Joan Doe"). Lanes are departments only.

---

## Build order
1. **1.1–1.5** — declutter + navigation + Auto-arrange Undo.  ✅ DONE.
2. **2 data** — nodes store pool + department; ProcessLane records (with origin) per level; auto-create /
   auto-cleanup lanes on assign; createLane/deleteLane endpoints; getFlow returns lanes.  ✅ DONE.
3. **2 render** — pool/lane bands + snap nodes in + the Swimlane view toggle.  ✅ DONE.
   (swimlane-layout.ts builds the bands; SwimlaneBandNode draws them; ProcessCanvas branches on
   a `swimlane` prop; page has a "Swimlanes" toggle + a Pool/Lane picker in NodeDrawer.)
4. **2 connections** — solid within pool, dotted across pools; orthogonal (smoothstep) routing.  ✅ DONE.
5. **Later** — drag-to-reorder lanes, drag node between lanes, per-lane "+ Add step", parallel/message events.
