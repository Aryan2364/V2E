# P3 adapters and outstanding duplicates

Tracks every v2e `components/ui` file that duplicates a now-ported kit
component, per the P3 brief's fan-out rule. "Adapter" = thin wrapper that
renders the kit component under the old name/API. "Original" = still the
pre-kit implementation, not yet touched.

## Converted to thin adapters (done this phase / already in place)

| File | Wraps | Call sites | Notes |
|---|---|---|---|
| `Toast.tsx` | `sonner.tsx` (`toast`) | ~75 | `useToast().addToast(message, type)` now calls sonner's `toast.success/error/warning/message`. `<Toaster />` is mounted once in `app/layout.tsx`. `ToastProvider` is a no-op passthrough. |
| `PermissionTooltip.tsx` | `tooltip.tsx` | 9 | Already delegates to the kit's `Tooltip` (`./tooltip`). Takes `allowed`/`reason` like the kit's `permission-tooltip.tsx`; call sites unchanged. New code should prefer `@/components/ui/permission-tooltip` directly, wired via `@/lib/auth/permission-tooltip-adapter.ts` (`useCanWithReason`). |
| `DatePicker.tsx` | `date-picker.tsx` | 28 | Converts v2e's ISO `yyyy-mm-dd` string value to/from the kit's `Date`. `min`/`max` and `markedDates`/`markedHint` were added to `date-picker.tsx`/`calendar.tsx` for this (FRONTEND_RULES.md section 4.1 "v2e additions"). Deviation: `compact`, `hideClear` and `bare` (borderless toolbar trigger) have no kit equivalent and are accepted but unused — the field always renders the kit's one appearance now. |
| `DateRangePicker.tsx` | `calendar.tsx` (`mode="range"`) / `popover.tsx` | 9 | Keeps v2e's `{from, to}` ISO-string contract. Built directly on the kit calendar's existing range mode (range_start/range_middle/range_end classes already shipped in `calendar.tsx`; no kit change needed). Presets (Today, Last 7/30 days, …) are v2e's own list, kept as-is in the adapter rather than moved into the kit. |
| `TimeField.tsx` | `time-picker.tsx` | 9 | Converts v2e's `"HH:MM"` 24-hour string to/from the kit's 12-hour `TimeValue`. Deviation: the old centered analog-clock dialog (`ClockTimePicker.tsx`) is replaced by the kit's inline popover with hour/minute/AM-PM lists; `label` and `compact` have no kit equivalent and are accepted but unused. Minutes now step to the kit's 15-minute grid on typed entry (section 20.2) instead of accepting any minute. |
| `Modal.tsx` | `dialog.tsx` | 32 | Same `isOpen`/`onClose`/`title`/`size`/`closeOnEscape`/`bodyScroll`/`elevated`/children API; now composes `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`. `size` maps onto the kit's sm/md/lg. Escape vs backdrop-click behaviour preserved via `onOpenChange`'s close reason. `elevated` is kept for its one call site (`components/goals/QuickCreateProjectModal.tsx`) but is a no-op: Base UI's portals already paint in mount order, so a modal opened from within one still lands on top. |
| `ConfirmDialog.tsx` | `alert-dialog.tsx` | 21 | Same `open`/`title`/`message`/`confirmLabel`/`cancelLabel`/`danger`/`loading`/`error`/`onConfirm`/`onCancel` API; now composes `AlertDialog`/`AlertDialogContent`/`Header`/`Footer`/`Title`/`Description`/`Action`/`Cancel`. Danger by default. Escape and the backdrop are ignored by the kit's `AlertDialog` itself (section 24 rule 3) - accepted per the brief, not a regression (the old version also only closed via its two buttons). The loading spinner on the confirm button and the inline error banner aren't modelled by `alert-dialog.tsx`, so both are added inside this adapter, not the kit file. |
| `StyledSelect.tsx` | `select.tsx` (6 options or fewer) / `searchable-select.tsx` (7 or more) | 42 | Same `value`/`onChange`/`options`/`placeholder`/`wrapperClassName`/`triggerClassName`/`size`/`disabled`/`searchable`/`searchPlaceholder` API (`searchable` is now accepted but unused: section 16.3's 6-option line decides, not the caller). `StyledSelectOption`'s colour dot, divider, danger variant and non-selectable "action" row are real variants on the kit files themselves — `select.tsx`'s `SelectItem` and `command.tsx`'s `CommandItem` both gained `variant?: "danger"`, and `searchable-select.tsx`'s `options` now also accepts the richer `{value, label, color?, divider?, variant?, action?}` entry shape alongside its original value-to-label map — see FRONTEND_RULES.md section 4.1 "v2e additions". `size="sm"` (compact chip-scale rows) has no kit equivalent and is kept as an adapter-only trigger-height override. |

## Still the original v2e implementation — not yet adapted or migrated

Real migration (editing call sites to use the kit component directly) is
preferred under ~25 sites per the brief; everything below is over that bar,
or has too different an API to convert mechanically without per-call-site
review, so it is left for a dedicated follow-up pass instead of a rushed
partial conversion.

| File | Kit equivalent | Call sites | Why not done this pass |
|---|---|---|---|
| `ResponsiveTable.tsx` | `table.tsx` | 23 | `ResponsiveTable` already implements the kit's mobile card-list rule itself (desktop table collapses to cards below a breakpoint); `table.tsx` has no such mode. Needs a deliberate design decision, not a mechanical swap. |
| `MultiSelect.tsx` | `multi-select.tsx` | 5 | Supports `color`/`colorClassName` dots and `hint` lines not in the kit version yet. |
| `ViewToggle.tsx` | `view-switcher.tsx` | 3 | Not started; likely a near-mechanical swap, low priority given the small count. |
| `useHoverTip.tsx` | `tooltip.tsx` | 2 | Hand-rolled portal tooltip with an inline hex colour (`#0F172A`) — violates kit §1 rule 1. Small count; migrate call sites directly to `tooltip.tsx` rather than adapting. |
| `FilterButton.tsx` | `popover.tsx` | 1 | Single call site — migrate directly. |
| `ClockTimePicker.tsx` | `time-picker.tsx` | 0 (dead code, found in P3; its last caller `TimeField.tsx` was converted to an adapter this pass) | No remaining call sites — safe to delete outright in a follow-up rather than adapt. |

## Migrated directly (component file removed)

| File | Migrated to | Call sites | Notes |
|---|---|---|---|
| `MonthDayPicker.tsx` | `calendar.tsx` (inline, in `components/tasks/ScheduleEntryRow.tsx`) | 1 | Its one call site now uses a small local `MonthDayPicker` wrapper (kit `Calendar` + `Popover`) built directly into `ScheduleEntryRow.tsx`; the shared file was deleted. Maps `{month, day}` to/from a `Date` in a fixed leap year (2000, discarded on read) so 29 Feb stays pickable. |
| `SelectField.tsx` | `select.tsx` (inline, in `app/settings/system/audit-logs/page.tsx`) | 1 | Its one call site (5 filter dropdowns) now composes `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem` directly; the shared file was deleted. Each filter's "All ..." option is mapped to/from a local `ALL_VALUE` sentinel rather than `''`, because Base UI's `Select` treats an item whose value stringifies to `''` as "nothing selected" and falls back to the trigger's placeholder instead of showing that item's own label. |

## Phone duplicates to consolidate (not forced this phase)

`components/phone/*` re-expresses several kit parts for v2e's phone work
(built on `feat/phone-app`, predates this kit-alignment branch). None were
broken by this phase. Candidates for a later mechanical swap once their
desktop/phone API gap is reviewed:

| Phone file | Overlaps with kit | Status |
|---|---|---|
| `components/phone/PhoneSheet.tsx` | `sheet.tsx` (`side="bottom"`, phone branch) | Kit's `sheet.tsx` already implements the phone bottom-sheet contract (drag handle, history entry, `presentation="screen"`). Needs a side-by-side behavioural diff before swapping — out of scope this pass. |
| `components/phone/UndoToast.tsx` | `sonner.tsx` (`toast.undo`) | Kit's sonner already ships `toast.undo` (10s, one Undo, Ctrl+Z). Likely redundant; not swapped yet. |
| `components/phone/PhoneAppBar.tsx` | `components/shell/app-bar.tsx` (kit, not yet ported — see page-header.tsx's note) | Kit's app-bar/PageHeader phone branch was deliberately left unported this phase (locked decision D4: v2e shell not restructured yet). Revisit once the kit's shell is actually adopted. |
| `components/phone/PhoneEmptyState.tsx` | `empty-state.tsx` | Kit's empty-state covers the same 6 variants; v2e's phone version may already just be a thin wrapper — needs a read, not confirmed this pass. |
| `components/phone/DraftBanner.tsx` | `draft-banner.tsx` | Kit ships an equivalent built on `banner.tsx` + `lib/drafts.ts`. v2e's phone `lib/drafts.ts` was already reconciled in P2/earlier phone work; compare field-for-field before swapping. |
| `components/phone/PhoneOnly.tsx` | `components/shell/phone-only.tsx` (kit, not yet ported) | Not ported this phase; same reasoning as PhoneAppBar. |
| `components/phone/primitives.tsx` | various kit `components/ui/*` | Grab-bag file; needs a per-export breakdown before any swap. |

## Kitchen sink

Two kit demo functions depended on components explicitly **not** ported this
phase (`notification-permission-sheet.tsx`'s `NotificationPermissionSheet`
and `comment-box.tsx`'s `CommentBox` — see the `Caption` notes left in
`app/kitchen-sink/page.tsx` near their old call sites) because both need the
kit's own shell/content-area plumbing. Their demo wrapper functions
(`NotificationSheetDemo`, `CommentBoxDemo`) were removed rather than left as
dead code referencing undefined names.
