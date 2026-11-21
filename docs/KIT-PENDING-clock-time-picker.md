# Pending kit change: analog clock-face time picker on desktop (owner decision, 2026-10-20)

Status: **wanted for v2e's desktop layout, NOT in `kits/frontend-kit/FRONTEND_RULES.md` section 20.2.** v2e deliberately differs from the kit on the points below. The kit itself is not to be edited from v2e.

**Why:** owner, 20 Oct 2026: option lists for hour, minute and AM/PM are a poor way to show time; people read and set time on a clock face.

## What the kit says

Section 20.2: separate hour and minute controls, both typeable and selectable, shown as option lists in a popover (`time-picker.tsx`), minutes in 15-minute steps by default.

## What v2e does

1. The field stays typeable (20.2), with `step` as before. The phone keeps its native picker (41.9 rule 10).
2. The in-field clock button opens a **dialog with an analog clock face** instead of the popover lists: the chosen time large at the top (hour and minute parts switch what the dial picks, AM/PM toggle), hour picked on the dial then minutes with automatic advance, any minute 0 to 59 by pointing between the 5-minute labels or dragging.
3. Keyboard: the dial takes focus; arrows change the value (Shift or Page keys by 5 minutes), Space switches hour/minute, Enter sets, Escape cancels.
4. It opens from inside other dialogs (forms with time fields). It is a kit Dialog on the kit layers, with click and key propagation stopped so the parent dialog and its unsaved-changes guard are untouched. This is an exception to section 24 rule 4 and would need to be accepted with the change.

## Where to copy from

- `frontend/components/ui/clock-time-picker.tsx` (the dialog, kit tokens only)
- `frontend/components/ui/time-picker.tsx`: the `pickerVariant="clock"` and `pickerLabel` props (marked as a v2e deviation)

## Sections to amend

- Section 20.2: a clock-face dialog as the desktop picker, typing kept
- Section 24 rule 4: allow a picker dialog opened from a form dialog
- `components/ui/time-picker.tsx`: optional `pickerVariant`
- Section 4.1 and `FRONTEND_RULES_COMPONENTS.md`: add `clock-time-picker.tsx`; render it on `/kitchen-sink`
