# Process Maps — Composition & Nested Canvas
### Phased build spec (plain-English, locked model)

> Status: **design locked**, not yet built. This is the plan we agreed on across the
> discussion. Written so a non-developer can follow it and an engineer can build it.

---

## 1. The idea in one paragraph

A container / sub-process is not a different thing from a **map** — it's a map at a
smaller scale. So **everything is a map**, and maps **compose**: a box on one map can
*point at* another map. The same nested thing can be seen **four ways** — as a
**collapsed box**, an **expanded titled band** shown inline, a **drilled-into** level
that fills the screen, or **opened as its own map** from a list. You **build in place**
(and it instantly becomes a real, reusable map), you **reference** existing maps to reuse
them, and you **detach** an instance into its own copy when you want a variant. The maps
list is a **searchable tree** so everything is reachable without clutter.

---

## 2. Vocabulary (shared language)

- **Map** — the reusable unit. HR, Finance, "Order to Production" are all maps.
- **Master** — the one canonical copy of a map (e.g. the real HR map).
- **Instance / reference** — a box on some map that *points at* a master. It shows the
  master's content and **auto-updates** when the master changes.
- **Build-in-place** — drawing a new area on a canvas; it *auto-becomes* a master map,
  nested under the current one, and shows up in the list. No "go create it elsewhere first."
- **Insert reference** — dropping an instance of an *existing* map onto the canvas.
- **Detach ("Make my own copy")** — turn an instance into an independent copy: it
  snapshots the master's current content, then diverges. **Clean one-time copy — never a
  live partial override.**
- **Phase** — a collapsed area you connect in sequence ("Order to Production" →
  "Production to Packing"). The arrow means *end of A hands off to start of B*.
- **Expand / collapse** — fold an area to a box or unfold it inline (a titled band with
  its steps inside, which stay clamped inside the band).
- **Pin** — mark a map to appear at the top level of the list (the few you use daily).
- **Local-only** — the opt-out: mark an area *not* to be a reusable/listed map (just a
  private grouping). Default is the opposite: every area **is** a listed map.

---

## 3. What changes vs. today (and back-compat)

- **Today:** the canvas renders **one level at a time**; a container is a nested level you
  *drill into*; connections live within a single level; a map is a flat top-level thing.
- **New:** the canvas can show **many nested levels at once** (fold/unfold in place); any
  box can be a **reference** to another map; the list is a **tree**.
- **Back-compat:** existing maps keep working unchanged. Existing nested containers become
  "local-only" groupings by default and can be **promoted to maps** on demand (a
  one-click action). Nothing breaks; the new powers layer on top.
- **On hold:** the earlier "block all container connections" change is **not** shipped —
  Phase 5 replaces it with the correct rule (connect anything that has a single way in and
  out; that includes collapsed phases).

---

## 4. Data model (conceptual — for the engineer)

- `ProcessMap` gains:
  - `parent_map_id` (nullable) → maps form a **tree** (drives the list).
  - `is_pinned` (bool) → show at the list's top level.
  - `is_listed` (bool, default true) → the **local-only** opt-out.
  - `entry_node_id` / `exit_node_id` (nullable) → the single "way in / way out" used when
    the map is connected as a phase (default: its start_event / end_event, or first/last node).
- A node's "inside" is one of:
  - **reference** → `linked_map_id` points at a master (generalises today's cross-link).
    This is an **instance**.
  - **local children** → today's `parent_node_id` nesting (a local-only group).
- **Build-in-place** (creating a container/sub-process): create a **new ProcessMap**
  (`parent_map_id` = current map) **and** a reference node pointing at it — one action,
  two results (master + instance).
- **Detach**: deep-clone the referenced map (nodes, connections, documents, sub-references)
  into a new ProcessMap, repoint this instance at the clone, done. The master and other
  instances are untouched.
- **Instance layout:** the *box's* position lives on the parent map; the *insides* (node
  positions, connections) come from the master — so two instances look consistent, and a
  master edit reflects in all of them for free.

Authorization: reuse the existing per-map / per-node sharing. An area only appears in the
list / is referenceable for people allowed to see it. Every new endpoint gates the object,
per `backend/AUTHORIZATION.md`.

---

## 5. The phases

Ordered to ship value early and to **de-risk the hard part** (nested inline rendering)
after the safer data/navigation work.

### Phase 1 — Composition core  *(high value, medium risk)*
**Goal:** reuse a map in many places, editing it once.
- `parent_map_id` + tree; **maps list becomes a searchable tree** (Section 6).
- **Build-in-place** creates a master + instance; the new map appears nested in the tree.
- **Insert reference:** pick an existing map, drop an instance.
- **Edit-once-reflects:** because an instance renders the master, master edits show
  everywhere automatically.
- **Promote** an existing local container → a map (migration path).
- **Acceptance:** build "HR" on the Company map → HR appears as its own map in the tree and
  opens directly; reference HR on a second map; edit HR once → both update.

### Phase 2 — Detach (copy-on-write)  *(low risk)*
**Goal:** a variant without touching the master.
- "Make my own copy" on any instance → snapshot-clone into a new map, repoint, diverge.
- New copy gets a name (default "HR (copy)"; editable).
- **Acceptance:** HR referenced in 3 places; detach the 4th; edit the copy freely; the
  other 3 and the master are unchanged.

### Phase 3 — Expand / collapse in place  *(the hard one — spike first)*
**Goal:** see nested areas unfolded on the same canvas, to any depth.
- **Prototype first:** render one referenced map inline as a bounded, titled band using
  nested/group nodes with children clamped to the band ("extent: parent"). Prove the
  layout before committing.
- Per-node **expanded/collapsed** state; collapse = box, expand = band-with-steps-inside.
- Arbitrary depth + **selective fold** ("open down to C, keep A and B closed").
- **Nested auto-layout** (a band grows to hold its children and pushes neighbours aside,
  recursively) — the main engineering risk; budget for it.
- **Acceptance:** with A∈B∈C∈D, show the whole hierarchy on one screen; also fold to any
  chosen level; a step never leaks out of its band.

### Phase 4 — Seamless navigation  *(polish on Phase 3)*
**Goal:** "never feels cluttered."
- **Semantic zoom:** zoom out → deep detail auto-folds into boxes; zoom in → it unfolds.
- **Show-all / collapse-all / fold-to-level** controls; outline tree stays the co-pilot for
  "jump/expand to exactly here."
- **Acceptance:** a big org map is readable at every zoom level without manual fiddling.

### Phase 5 — Phase connections  *(depends on Phase 3)*
**Goal:** connect areas in sequence, honestly.
- A **collapsed** area is connectable; the arrow auto-wires **exit of A → entry of B**
  (its last/`exit_node_id` → the next's first/`entry_node_id`).
- **Grouped view** (boxes) ⇄ **Whole view** (bands) toggle.
- **Guardrail / the connection rule (replaces "block containers"):** you may connect
  anything that presents a **single way in and out** (steps, sub-processes, collapsed
  phases). If an area ends in a branch (two exits), the tool asks you to put the **decision
  between** phases rather than folding it inside — so the arrow never lies.
- **Acceptance:** "Order to Production → Production to Packing → Packing to Dispatch" reads
  as three connected boxes and, unfolded, as one continuous a→s flow with titled bands.

---

## 6. Cross-cutting: the tree/search list (locked)

Default-accessible **without** clutter:
- "All maps" shows a **tree** (Company ▸ HR ▸ Recruitment ▸ …) with a **search box** that
  jumps to any map at any depth.
- **Permission-gated** — you only see what you're allowed to.
- **Pin** the handful you want at the top level; everything else lives in the tree,
  reachable but not flooding the root.
- So "by default reachable" ≠ "default top-level clutter."

---

## 7. Open risks & things to prototype early

1. **Nested auto-layout** (Phase 3) — the biggest unknown. Prototype with a real 3-deep
   example before committing the phase.
2. **Cross-map inline rendering** — expanding an *instance* means drawing another map's
   contents inline; confirm performance with ~200 nodes.
3. **Entry/exit designation** — how we pick a map's single in/out (auto from start/end
   events, with a manual override) so phase connections stay truthful.
4. **Detach depth** — detaching a map that itself contains references: clone the top only
   (keep inner references shared) — recommended — or deep-clone all the way down? Decide
   per use; default = clone top, keep inner refs shared.

---

## 8. Effort & sequencing note

This is a **multi-phase program**, not a single change — Phases 1–2 are mostly
data/navigation and ship real value fast (reuse + variants). Phase 3 is the ambitious
visual re-architecture and deserves a spike before a full commit. Each phase is
independently shippable and leaves the tool working.

**Next step:** on your go, I start **Phase 1** (data model + tree/search list +
build-in-place + insert-reference). Everything above is locked; we only revisit inside a
phase if a prototype surprises us.
