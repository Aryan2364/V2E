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

## Still the original v2e implementation — not yet adapted or migrated

Real migration (editing call sites to use the kit component directly) is
preferred under ~25 sites per the brief; everything below is over that bar,
or has too different an API to convert mechanically without per-call-site
review, so it is left for a dedicated follow-up pass instead of a rushed
partial conversion.

| File | Kit equivalent | Call sites | Why not done this pass |
|---|---|---|---|
| `Modal.tsx` | `dialog.tsx` | 32 | Different prop shape (`isOpen`/`onClose` vs Base UI's open/onOpenChange composition); needs a per-call-site read of `size`/`closeOnEscape` usage before a safe adapter. |
| `ConfirmDialog.tsx` | `alert-dialog.tsx` | 21 | Same shape mismatch as Modal; also carries its own loading/error-message handling that the kit's alert-dialog does not model 1:1. |
| `StyledSelect.tsx` | `searchable-select.tsx` | 42 | `StyledSelectOption` supports colour dots, dividers, danger variant and non-selectable "action" options — richer than the kit's option shape. Needs those variants added to `searchable-select.tsx` (kit-component-variant rule, FRONTEND_RULES.md §4 rule 4) before call sites can move, not a wrapper. |
| `DatePicker.tsx` | `date-picker.tsx` | 28 | v2e's takes ISO string + `markedDates`/`markedHint` (leave-day dots) which `date-picker.tsx` doesn't support yet. |
| `ResponsiveTable.tsx` | `table.tsx` | 23 | `ResponsiveTable` already implements the kit's mobile card-list rule itself (desktop table collapses to cards below a breakpoint); `table.tsx` has no such mode. Needs a deliberate design decision, not a mechanical swap. |
| `DateRangePicker.tsx` | `date-picker.tsx` / `calendar.tsx` | 9 | Needs the "range variant on top of kit calendar" called for in the brief; not started. |
| `TimeField.tsx` | `time-picker.tsx` | 9 | Different value shape; not started. |
| `MultiSelect.tsx` | `multi-select.tsx` | 5 | Supports `color`/`colorClassName` dots and `hint` lines not in the kit version yet. |
| `ViewToggle.tsx` | `view-switcher.tsx` | 3 | Not started; likely a near-mechanical swap, low priority given the small count. |
| `useHoverTip.tsx` | `tooltip.tsx` | 2 | Hand-rolled portal tooltip with an inline hex colour (`#0F172A`) — violates kit §1 rule 1. Small count; migrate call sites directly to `tooltip.tsx` rather than adapting. |
| `SelectField.tsx` | `select.tsx` | 1 | Single call site — migrate directly, don't adapt. |
| `MonthDayPicker.tsx` | `calendar.tsx` | 1 | Single call site — migrate directly. |
| `FilterButton.tsx` | `popover.tsx` | 1 | Single call site — migrate directly. |
| `ClockTimePicker.tsx` | `time-picker.tsx` | 0 (dead code found this pass) | No remaining call sites — safe to delete outright in a follow-up rather than adapt. |

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
