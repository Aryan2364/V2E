Product: V2E
Brand colour: #2563EB

Both lines are placeholders. Section 0.1 lists everything a new product fills in before its first screen is built.

# Design and Build Rules

## 0. How to use this file

Read this file completely before writing any code in this project. Section 0.3 lists three more rules files and when to read each.

These rules are not suggestions. If a rule prevents you from doing something, stop and ask rather than working around it.

If something is not covered here, ask before inventing an answer. Do not fill gaps with your own judgement.

### 0.1 Starting a new product from this kit

Almost all of this file and the components beside it carry across to a new product unchanged. The items below do not. Settle all of them before the first screen is built.

1. **The brand block in globals.css.** The eight brand tokens (section 2.2) and the three scrollbar colours (section 10.1) are edited together, as one block. Derive the scrollbar colours from the new primary using the rule in section 10.1. Changing --primary alone leaves the other brand tokens and the scrollbar on the previous brand. The sign-in accent colour, --on-brand-accent (section 11.7), is part of the same block. If section 21.1 requires a chart colour substitute, record it in this same block. The install settings in lib/install-settings.ts hold the brand as plain values (section 41.12 rule 9): the theme and background colours, the colour of the mark on the icon, and the iPhone status-bar setting (section 41.13 rule 4). They are edited with this block.
2. **The product name and brand colour lines** at the top of this file.
3. **The table in section 2.2**, rewritten to match the values actually in globals.css.
4. **The sidebar destinations in section 12.1.** The rules on width, grouping, the active item and the seven-item limit stay. The list of destinations is the product's own, and so are the phone tab bar's tabs (section 41.4 rule 15).
5. **The sign-in brand panel (section 11.7):** the product mark, product name, headline, highlighted phrase and supporting line are the product's own.
6. **Section 18, if the client is not Indian.** Date order, digit grouping and the rupee symbol are regional, set once at the top of lib/format.ts with the time zone. The rule that one format is used everywhere is not.
7. **--on-brand-muted (section 36.8), only if needed.** It must measure at least 4.5 to 1 against primary. Check it only when primary-foreground measures below about 7 to 1 against primary; above that it always clears.
8. **The unit, if the product has roles (section 40).** The product's one business-unit dimension (branch, plant, territory, region), its singular and plural, and whether units are grouped. These are the declarations of the backend kit's ACCESS_RIGHTS.md section 0.2, so the two always match. They are set once in lib/permissions.ts and never typed into a screen. --spacing-col-scope (section 40.4) is re-measured for the product's own unit word.
9. **The phone (section 41).** Which screens are on phone, change shape, or stay on the computer (section 41.1), recorded in plan.md; and the install settings: app name, short name, icons and colours (section 41.12 rule 9).
10. **Language and sign-in.** The product's one language (section 37.6), and its sign-in method, email and password, mobile number and OTP, or both (section 11.7). A language other than English re-measures the col-* widths and other measured widths (section 17.1).

Two things start fresh rather than being edited:

- plan.md is per-product state. Start it from plan-template.md.
- Section 30 starts empty.

### 0.2 Where this file lives

This file is FRONTEND_RULES.md. It sits in the product's frontend folder, beside the Next.js app. Two files in the same folder make sure the frontend agent loads it automatically. Commit both, and keep them in place.

1. **AGENTS.md:** next dev writes its own block into this file and re-creates it if it is missing. Leave that block untouched and add this pointer below it. next dev manages only its own block, so the pointer stays.

   ```markdown
   ---

   # The frontend rules are in FRONTEND_RULES.md

   Read `FRONTEND_RULES.md` in this folder before writing any code. It is
   the design and build specification for this product's frontend.
   ```

2. **CLAUDE.md:** two lines, so both files load automatically:

   ```
   @AGENTS.md
   @FRONTEND_RULES.md
   ```

   Only FRONTEND_RULES.md is loaded this way. The three other rules files (section 0.3) are never added to CLAUDE.md with @; the agent reads each one when the work needs it, which keeps every session's load under Claude Code's limit.

### 0.3 Where the rules live

The rules are split across four files so this one stays small enough to load in every session. Section numbers are the same in every file, so "section 41.5" means section 41.5 wherever it lives.

| File | Sections | Read it |
|---|---|---|
| FRONTEND_RULES.md (this file) | 0 to 20 except 11.7, 22 to 30, 33, 36 to 39 | Always, completely, before writing any code |
| FRONTEND_RULES_VIEWS.md | 21 Chart colours, 31 Data entry grid, 34 Report tables, 35 Board view | Before working on one of those views |
| FRONTEND_RULES_ACCESS.md | 11.7 Sign-in page, 32 Password fields, 40 Access screens | Every product, when building its sign-in page or a password field; and before working on people, roles or access screens |
| FRONTEND_RULES_PHONE.md | 41 Phone | Before working on anything that shows on a phone. On phone screens it wins where it differs |

1. When this file points to a section that lives in another file, read that file before acting on the reference.
2. A new section goes in this file unless it is only needed for one kind of screen. Keep this file under 140,000 characters (Claude Code warns when a loaded file passes 150,000); when it grows past that, move the next specialist section out the same way, and update this table.

## 1. Hard prohibitions

These are absolute. Breaking any of them is a bug, not a style choice.

1. Never write a hex colour code, an rgb() value or a named colour anywhere except globals.css. Everywhere else, use theme tokens only. The one exception is the phone install settings and the theme-color tag, which cannot read a token (section 41.12 rule 9).
2. Never use inline styles for colour, spacing or typography. There are two exceptions: CSS variables the layout code sets on the html element at runtime from what the phone reports, such as the keyboard's height (section 41.13); and the install icons drawn with Next's ImageResponse (lib/install-icon.tsx), which cannot read classes or tokens.
3. Never create a new component file if an existing component in components/ui can do the job.
4. Never build the same thing twice. If an element appears on more than one screen, it exists once in code and is imported.
5. Never rely on browser or operating system defaults for hover, focus, tooltips, scrollbars, dialogs or autofill. Every one of these is styled. The exceptions are the browser's own warning when a tab with unsaved changes is closed (section 11.3 rule 10) and, on phone, the phone's own date and time pickers, share sheet, install and permission prompts, and file viewer (section 41). No website can style these, and people already know them. Chrome paints an autofilled field its own pale blue and ignores background-color; override it in globals.css with box-shadow, using tokens only.
6. Never let text overflow its container.
7. Never render an unbounded list. Everything is paginated. The exceptions are the report table (section 34.2), the unit picker (section 40.7) and the tables of "What they can do" (section 40.9), and only because their rows come from master data or the code catalogue, which grow only when an administrator edits a list or a release ships. The phone list is bounded differently: it loads 25 at a time and stops at 200 rows (section 41.5).
8. Never nest a scrollable area inside another that scrolls on the same axis. Two same-axis scrollers trap the pointer in the inner one and the page stops responding. A horizontal scroller inside a vertical one is allowed; the data entry grid (section 31.4) is this shape. The one same-axis exception is the board (section 35.8), and only under the four conditions stated there.
9. Never use a spacing value outside the spacing scale in section 5.
10. Never install a new package without asking first. Never loosen, change or upgrade a pinned version (section 4.3).
11. Never place a back arrow button on a desktop or tablet page. Use breadcrumbs. The phone layout is the exception (section 41.4).
12. Never use placeholder text as a substitute for a field label.

## 2. Colour

### 2.1 The swap requirement

Changing the brand colour must be a change in one place only: the brand block in globals.css. Every screen follows automatically. Nothing outside globals.css may know what the brand colour is. Different products built from this kit use different brand colours.

### 2.2 Brand colour, current product

Every value in this section belongs to the current product, not to the system. A new product replaces them in globals.css and rewrites this table to match (section 0.1). If this table and globals.css disagree, globals.css is right and this table is the bug.

V2E's brand is blue, #2563EB, carried over unchanged from the phone-only block built on feat/phone-app (plan-kit-alignment.md decision D3: "brand color is ok for now").

Eight tokens make up a brand. All eight are set explicitly:

| Token | Value | Used for |
|---|---|---|
| primary | #2563EB | Resting state of main buttons, active tabs |
| primary-hover | #1D4ED8 | Mouse over. Darker, not lighter (this brand hovers DARKER) |
| primary-pressed | #1E40AF | The instant of click |
| primary-ring | #3B82F6 | Keyboard focus outline |
| primary-subtle | #EFF6FF | Selected rows, highlighted panels |
| primary-border | #BFDBFE | Borders on primary-subtle surfaces |
| primary-foreground | #FFFFFF | Text and icons on primary |
| primary-text | #2563EB | The brand colour used as text or icons on surface: links, secondary buttons, the active tab, labels in an accent band |

Rules:

- A dark brand hovers lighter and presses darker. A light brand hovers darker and presses darker still. V2E's blue hovers DARKER (#1D4ED8) and presses darker still (#1E40AF) — the opposite direction from the kit's own placeholder teal, which is exactly the point of this section: a formula cannot know which way a brand should hover, so these eight stay explicit.
- primary-foreground must measure at least 4.5 to 1 against primary, for any brand. White on #2563EB measures about 5.2 to 1.
- primary-text must measure at least 4.5 to 1 against surface. V2E's primary-text equals primary (#2563EB), at about 5.2 to 1 on white.
- primary-ring must measure at least 3 to 1 against surface, so keyboard focus stays visible.
- The eight are explicit values, not calculated from primary, because a formula cannot know which way a brand should hover. They are always edited together.

**Brand swap test.** Change --primary to an obviously wrong colour, load /kitchen-sink, and check every element's background, text, border and outline. The test passes when only the hand-set values of the brand block still hold the old colour: primary-hover, primary-pressed, primary-ring, primary-subtle, primary-border, primary-text, the three scrollbar colours (section 10.1), --on-brand-accent (section 11.7) and the install colours in lib/install-settings.ts (section 0.1 item 1). Anything else holding it is a component bypassing the tokens. The step-by-step procedure is check 9 of plan-template.md.

### 2.3 Neutral greys

| Token | Value | Contrast on white | Used for |
|---|---|---|---|
| text-primary | #171717 | about 17.9 to 1 | Body text, headings |
| text-secondary | #525252 | about 7.8 to 1 | Labels, supporting text |
| text-muted | #737373 | about 4.7 to 1 | Timestamps, counts, helpers |
| border | #D4D4D4 | — | Standard borders |
| border-light | #E5E5E5 | — | Dividers, disabled borders |
| surface | #FFFFFF | — | Cards, inputs, dialogs |
| surface-sunken | #FAFAFA | — | Page background, toolbars |
| surface-control | #F5F5F5 | — | Hover fill on buttons and icon buttons |
| surface-control-pressed | #E5E5E5 | — | Pressed fill on buttons and icon buttons |

Rules:

- text-muted must never be lighter than #737373. Lighter greys fail the contrast minimum.
- text-muted is only for information the user can afford to miss. Never use it for a price, a status or an instruction.
- The ratios above are measured on white. None of the three text tokens may be used on a section 36 header band; use on-brand and on-brand-muted (section 36.8) instead. On the current primary, text-muted measures under 2 to 1.

### 2.4 Status colours

| Meaning | Text | Background | Used for |
|---|---|---|---|
| success | #166534 | #DCFCE7 | Paid, Approved, Active, Completed |
| warning | #92400E | #FEF3C7 | Pending, Due soon, Needs review |
| danger | #991B1B | #FEE2E2 | Overdue, Failed, Rejected |
| neutral | #525252 (text-secondary) | #F5F5F5 (surface-control) | Draft, Inactive, Deactivated, Cancelled, Archived |

- The neutral row is for a status that is neither good nor bad: the record is simply not in use or not started. Its text measures about 7.2 to 1 on its background.
- Status colours never change with the brand. An orange brand still uses green for success and red for danger. These colours carry meaning, not brand.
- There is no blue "information" colour. Use neutral grey for informational content.
- **The "Used for" column is binding.** A status whose label appears in it takes that row's colour on every screen: Overdue is always danger, Pending is always warning, Paid is always success.
- **An exception must be written down.** Where a product uses one of these words with a different meaning (for example, "Active" meaning in progress rather than enabled), it records the exception at the point of use, naming three things: the label, the colour role used instead, and the reason. An unrecorded difference is a defect. Without a recorded exception, the column decides.
- A product's status-to-colour map is defined once and imported (section 4 rule 2), never copied into two files.

## 3. Typography

Font family: Geist. Confirm it is actually loading; a serif fallback means it has failed.

| Slot | Size | Weight | Line height | Colour |
|---|---|---|---|---|
| Display | 40px | 500 | 1.15 | on-brand (sign-in brand panel only) |
| Page title | 30px | 500 | 1.25 | text-primary |
| Section heading | 20px | 500 | 1.3 | text-primary |
| Card heading | 16px | 500 | 1.4 | text-primary |
| Body | 14px | 400 | 1.6 | text-primary |
| Body strong | 14px | 500 | 1.6 | text-primary |
| Label | 13px | 400 | 1.5 | text-secondary |
| Meta | 12px | 400 | 1.5 | text-muted |

Rules:

1. Only two weights exist: 400 and 500. Never 600 or 700. If a heading does not stand out enough, add space around it, not weight.
2. On a white surface, labels are always text-secondary. A label in text-primary reads as body text and the hierarchy collapses. On a section 36 header band a label takes on-brand; in an inner band's accent form it takes primary-text. In every case, a label never matches the weight and colour of the body text beside it.
3. One page title per screen.
4. Hierarchy comes from size, weight and colour moving together, never from size alone.
5. Body strong is for the active navigation item, emphasis inside a sentence, table total rows, and values in label-value pairs.
6. Display is used only for the headline on the sign-in brand panel (section 11.7). It is never used on any other screen, and it is not a page title.
7. The phone layout sets its own values for some of these slots (section 41.9). Its page title sits in the app bar at 20px.
8. Compact mode is reserved but not built. Write all type sizes and spacing as tokens, so a compact variant can later be added by changing token values only.

## 4. Reuse discipline

1. Add and Edit are the same form component. One file, same fields, same order, same labels, same validation. Only the title and the submit button label differ.
2. Any element appearing on more than one screen is defined once and imported: buttons, cards, empty states, headers, filters.
3. Before creating anything, search the project for an existing component that does the job. Extend it rather than duplicating it.
4. If two screens need slightly different versions of the same thing, add a variant to the existing component. Do not create a second component.

### 4.1 Component inventory

Read this table before adding any file to components/ui. Names here do not always match those in other libraries, and searching for the wrong name leads to a duplicate.

- **Banner is this kit's Alert.** There is no alert.tsx and there must never be one. It is named after section 7.1, where banner, toast, inline error and dialog are chosen by rule.
- **SearchableSelect** is the answer for any list of 7 options or more (section 16.3), and **MultiSelect** for choosing several values from a list. Do not build another.

| File | What it is |
|---|---|
| alert-dialog.tsx | Confirmation for an irreversible action (section 15). Danger by default. Escape and the backdrop do nothing. Capped at 80vh; the consequences scroll so Cancel is always reachable. Its header is deliberately not a section 36 band (section 36.6). On phone it stays a centred dialog, the screen width less 32px and the side safe areas, its two buttons sharing the width (section 41.8 rule 11); Android back presses its Cancel. |
| approval-select.tsx | useApprovalSelection: approving several at once on phone (section 41.6 rules 14 to 19): the Select button, the select-mode app bar and action bar, one history entry so Android back leaves select mode, 50 at most, one Undo toast, skipped rows marked (skippedBadge, clearSkipped). RejectReasonSheet is the one reject-reason sheet, for a list and a single record. A refusal the server explains (RefusedError) shows its own reason. |
| avatar.tsx | Person or record image with an initials fallback, plus grouped and badged forms. |
| badge.tsx | Status as a badge, never as coloured text (sections 2.4, 11.1). Carries an icon as well as a colour. Also exports Count, the one count style of section 6.8 for buttons, tabs and menu items: a primary pill, 99+ over 99. |
| banner.tsx | A condition that persists until resolved (sections 7.1, 7.5). This is Alert. layout="line" is the one-line banner on a page, with BannerClose and useBannerDismissal where it may be closed; the default stacked layout is for a banner inside a form or dialog. On phone a line banner wraps to two lines, then truncates; its action is a standing text link on its own line below; its close sits top right (section 41.8 rule 15). useBannerDismissal keeps a closed banner in a cookie the server reads, so the first paint is right: a closed banner is never drawn and an open one is there from the start. |
| bar-chart.tsx | CategoryBarChart: horizontal grouped bars over Recharts (section 21). Six series maximum, zero baseline, direct labels. The caller cannot choose a colour. |
| board.tsx | Board view (section 35). One column per status value, with no maximum; 25 cards per column, then Load more. The column header shows the true total. Cards move through onMove, reached by the three-dot menu, by dragging, or by keyboard (section 35.6). Also exports useBoardAvailable, the single implementation of the board's availability rule, which asks useLayout() (sections 35.3, 41.2). |
| breadcrumb.tsx | Position within the software's structure. Replaces back buttons on desktop and tablet. Hidden on phone, where the app bar's back arrow and title replace it (section 41.4 rule 8). |
| button.tsx | The four levels of section 6 at the three fixed heights, plus the in-field variant (section 6.3.1) and the on-brand variant (section 6.3.2). Its forwardRef is required; do not remove it (section 4.2). The on-brand variant at a text size draws a 1px on-brand-muted border, so a text button on the band (Select, section 41.6 rule 14) has a visible border (6.1 rule 5). loading is the one loading state of section 14 rule 2: disabled, aria-busy and "Saving" (loadingLabel for other words), at an unchanged width. |
| calendar.tsx | Month grid behind DatePicker. Week starts Monday. Day cells are grid cells, not buttons (section 6.1 rule 5). |
| card.tsx | Two variants (section 36.10). panel, the default, holds a section of a screen and has a brand band header. record is a record itself (card view, board card) and has no band. The description sits below the title row and clamps to two lines. Cards rest at --shadow-card. CardLink, in a record card's title, makes the whole card open the record (section 11.6) and lifts it to --shadow-menu on hover. |
| checkbox.tsx | Tick box at the 4px radius. First column of any multi-select list (section 22). indeterminate draws the partly ticked state, a minus on the ticked fill, for a tick that stands for a group (section 40.3). |
| choice-row.tsx | ChoiceRow: a tick box, radio or switch with its label. On phone a row at least 48px tall where a tap anywhere changes it (section 41.7 rule 10); on desktop the control and label as elsewhere in the kit. |
| command.tsx | Keyboard-driven palette over a filterable list, usually inside a dialog. On phone: no box, the list uncapped, 48px rows, the search box never focused by itself and asking for the search keyboard, no pointer highlight; the chosen row is announced. |
| comment-box.tsx | CommentBox: the message box of a comments screen (section 41.6 rule 5). On phone it is fixed above the keyboard and takes part in the bottom-bar contract, grows to 5 lines then scrolls inside itself (section 41.7 rule 11), and Enter makes a new line while the send button sends (section 41.7 rule 6); on desktop a plain row where Enter sends (section 39.2). Sending uses the button loading state; a failed send keeps the text and shows an error toast. |
| connection-banner.tsx | ConnectionBanner (also OfflineBanner, OfflineScreen, useOnline), mounted by the shell on phone: the offline banner (no close; it outranks every other banner while it shows) and the new-version banner, which waits while a form has unsaved changes (section 41.14 rules 6 and 11). |
| date-picker.tsx | DD Mon YYYY field, typeable as well as pickable (sections 18, 20.1). On phone the field opens the phone's own picker through NativePickerField (exported here), shown as DD Mon YYYY, with no typed entry (section 41.9 rule 10). |
| dialog.tsx | The three widths of section 24. Header and footer fixed, body scrolls; the component builds the scrolling body itself. The header is a section 36 band. On phone the size decides (section 41.8 rule 10): sm becomes a bottom sheet; md and lg a full-screen layer with the app bar, a back arrow and the footer as the action bar. A DialogClose in that footer is left out: Cancel is the back arrow (section 41.7 rule 3). The root is sheet.tsx's. |
| draft-banner.tsx | DraftBanner (section 41.7 rules 13 and 14): "You have an unsaved draft from 3:45 PM." with Use draft and Discard, or the line saying a draft was not used because the record changed. Built from banner.tsx; reads lib/drafts.ts. |
| dropdown-menu.tsx | Menu of actions, including the three-dot menu. Not for choosing a value. DropdownMenuLabel must sit inside a DropdownMenuGroup, and DropdownMenuRadioItem inside a DropdownMenuRadioGroup. Without the parent it throws and the page goes blank. On phone an action sheet titled by its trigger, with 48px rows; sub-menus, and a whole menu opened inside a sheet, open as steps; a radio pick closes it. |
| empty-state.tsx | The three empty states of section 13 and the error pages of section 11.8, as a closed set of variants: nothing-yet, nothing-found, failed, not-found, no-access, nothing-waiting (My work or an approval list with nothing waiting, section 41.15 rule 9: the one variant with no action), and desktop-only for a computer-only screen opened on a phone (section 41.11: Share link, or Copy link, and Go to home; takes homeHref). The page forms take dashboardHref, and on phone homeHref, which reads "Go to home" (section 11.8 rule 6); failed takes the reference code. The heading is a real heading element; headingLevel sets its level. |
| header-band.tsx | The single implementation of the section 36 band. HeaderBand draws it at the level useBandLevel reads; BandScope, round each banded container, raises the level, so a nested header drops to the accent form. No call site passes a prop to HeaderBand. BandScope takes active (default true); only the phone shell passes it, so its scope is in the tree in both layouts and switching layout remounts nothing (section 41.2 rule 3). |
| keyboard-shortcuts.tsx | The section 39.5 shortcuts, mounted once around the application: Ctrl+K opens search (command.tsx), / moves to the list search (listSearchProps), Ctrl+S saves the current form, Ctrl+Z presses a showing Undo, ? opens the Keyboard shortcuts dialog. Also the Enter helpers of section 39.2: enterSends, ctrlEnterSaves, searchBoxKeys. On phone the Enter helpers follow section 41.7 rule 6: in a comment box Enter makes a new line and the send button sends. On phone Ctrl+K opens the search page (phoneSearchHref, section 41.4 rule 5). |
| inline-choice.tsx | The inline text control of section 6.7: the chosen value inside a sentence ("Show 25 records per page"), in primary-text, underlined, with a 12px chevron. It opens the select.tsx list, so it follows section 16 and its 6-option limit. Also the scope beside a tick in the permission grid (section 40.4). On phone it opens select.tsx's sheet, titled by its label. |
| inline-field-error.tsx | Message below a field that is wrong (section 7.1). Never a toast. |
| input-group.tsx | Input with an addon inside its border (section 6.5). The group owns the border, radius and height; the inner control takes h-full, not h-control. |
| input.tsx | Single-line field, 36px tall, capped at 480px (sections 6.2, 17). Hover moves the border only; no hover or pressed fill (section 6.4). |
| label.tsx | Field label, 13px text-secondary, above its field, with the required asterisk. |
| multi-select.tsx | Choosing several values from one list (section 16.3): the searchable-select trigger and menu, except that choosing a row ticks it and leaves the menu open. locked keeps an option as it is, disabled with its reason through permission-tooltip.tsx (section 26). On phone a full-height bottom sheet with the search fixed at the top and never focused by itself, or a step inside a sheet; a locked row shows its reason in the row on a tap. |
| notification-permission-sheet.tsx | NotificationPermissionSheet: the short sheet saying why, before the phone asks for notification permission (section 41.12 rule 4); PhoneNotificationsSetting for personal settings, including how to allow notifications after a refusal. |
| otp-field.tsx | OtpField: the OTP field of section 11.7 rule 2. One real input, numbers only, autocomplete one-time-code, drawn as one box per digit, never one input per box, so the phone's offer of the OTP from the SMS, pasting and screen readers all work. The box the next digit goes into shows the focus ring; onComplete runs once the last digit is in. length is the product's digit count, 6 by default, set once on the sign-in page (otpLength). |
| pagination.tsx | Zone 4 of a list page (section 11.1.1). Compact count on the left, plain controls on the right. PaginationLink renders an a when given an href, otherwise a button. |
| permission-tooltip.tsx | Makes a disabled control's reason reachable by hover, keyboard focus and tap (sections 19, 26). A tooltip on the disabled control itself never opens. allowed is true, false or undefined, and is required; undefined means not known yet and shows no reason (section 26.1). On phone it opens on a tap and closes on the next tap anywhere (section 41.8 rule 17). |
| password-input.tsx | The only password field (section 32), with its required show and hide toggle. |
| phone-list.tsx | PhoneList, PhoneListRow and PhoneAddButton (section 41.5): search, count line, filter and sort sheets, chips, status chips for a board list, the three-line row with where a search matched, 25 at a time up to 200, pull to refresh, the place kept, select mode for approvals. The screen owns search, filters, sort and loading (lib/list-address.ts keeps them in the address). Renders nothing on desktop. |
| popover.tsx | Floating container for the filter panel and the calendar. PopoverHeader, where used, is a section 36 band. PopoverFooter is its button row with the line above it. On phone the popover is a bottom sheet (its header the band, PopoverFooter the sheet footer), or a step inside a sheet. |
| radio-group.tsx | Exclusive choice. Round, so it is never confused with a tick box. |
| record-summary.tsx | The top of a phone record (section 41.6): RecordSummary (name, badges, meta, up to four key facts, KeyFacts), RelatedRows and RelatedRow (a related list, one row each), ActivityList (10 at a time up to 100, Add comment). Render nothing on desktop. |
| repeating-rows.tsx | RepeatingRows: repeating rows in any form (section 41.7 rule 16), controlled through value, onChange and renderRow. On phone a list of summarising rows with the total below, each opening its own full-screen layer to edit (Save in its action bar, Remove in its three-dot menu); on desktop the fields inline with a quiet remove button. Removing is undone from a toast (section 38.1); readOnly drops add and remove. |
| searchable-select.tsx | Picker for 7 options or more (section 16.3). Search box fixed above a scrolling list. On phone a full-height bottom sheet with the search fixed at the top and never focused by itself, or a step inside a sheet (useSearchPicker, shared with multi-select). |
| section-tabs.tsx | Section 33 tabs: sibling views of one section, active view in the URL, four maximum. Needs a Suspense boundary above it. On phone: directly under the app bar and pinned there, edge to edge, the tabs sharing the width, labels on one line (section 41.4 rule 21); a page passes them through PageHeader's tabs. |
| select.tsx | Dropdown for choosing a value, for 6 options or fewer (section 16.3). On phone the list is a bottom sheet titled by the field's label, or a step inside a sheet, with 48px rows and the chosen one ticked; section 16.3's limit stays. Its phone row parts are for the kit's own pickers and menus, not for screens. |
| separator.tsx | 1px divider in border-light. |
| sheet.tsx | Panel sliding in from an edge; the sidebar's overlay form below 1024px (section 9 rule 7). The header is a section 36 band. On phone, side="bottom" is the bottom sheet of section 41.8: drag handle with the top corners rounded only; swipe down from the handle or header to close, ignored within 24px of a side edge; up to 90% of the visible height, sitting on the keyboard; takes focus itself; one history entry per sheet and per step, so Android back closes it; every close goes through onOpenChange. SheetBody is the scrolling body; fullHeight is section 41.8 rule 8; presentation="screen" with screenTitle is the full-screen layer, whose SheetFooter is the action bar (data-fixed-bottom); useSheetStep() opens a choice as a step with a back arrow (rule 9). SHARE_THE_WIDTH and textOf are shared with the other overlays. |
| skeleton.tsx | Grey placeholder in the shape of the arriving content (section 14). Never a spinner. |
| sonner.tsx | Toasts (section 25). Bottom right, 360px; errors never auto-dismiss. toast.undo is the section 38.1 Undo toast: 10 seconds, one Undo, a confirmation once undone, and Ctrl+Z presses it while it shows. On phone: bottom centre, the screen width less 16px and the side safe areas each side (the 600px column held sideways), above the bottom bar and the keyboard, one at a time, except that an error, and an Undo toast during its 10 seconds, is not replaced by a confirmation (two at most; section 41.8 rule 13), dismissed by a sideways swipe. |
| state-matrix-check.tsx | Development only. Names any forced state in the kitchen sink's state matrix that looks identical to resting (section 6.4). Silence is the pass. |
| switch.tsx | Immediate on or off. If the change needs a Save, use a tick box on a form. |
| table.tsx | List tables (sections 10, 11.1, 22). The sticky column header is a section 36 band. containerClassName sets the scrolling height. Column widths come from the col-* tokens (section 17.1); TableHead clips its label. TableRowHeader is the section 34.3 row spine; its frozen option adds sticky-left and the 1px border. TableFooter has a sticky option for the section 34.1 total row, which stays neutral. Row hover and the selected tint apply to body rows only. TableRowLink is the record's name in a list row (section 11.1.2): a row holding one opens that record when clicked anywhere; report tables and grids have none and stay plain. |
| tabs.tsx | Tabs with the 2px active accent. One appearance only. |
| text-link.tsx | The text link of section 6.6: standing, inline or on-brand. A link to another website opens in a new tab with the external-link icon; with no href it renders plain text. A record's name in a table row is TableRowLink, not this. |
| textarea.tsx | Free-form text. The one field allowed to run full width. On phone it grows as the person types and never scrolls inside itself (section 41.7 rule 11), except the comments screen's message box (comment-box.tsx, section 41.6 rule 5). |
| time-picker.tsx | 12-hour hour and minute controls in 15-minute steps (section 20.2). Built here, not installed. On phone the phone's own picker, shown as h:mm A, any minute (TimeValue.minute is 0 to 59; desktop still steps by 15). |
| unsaved-changes.tsx | useUnsavedChanges: the section 11.3 rule 10 warning when leaving a changed form by a link, or closing its dialog or sheet (guard). mode is edit (the default) or create, for that rule's two wordings. isChanged compares values against the saved ones. onLeave runs when Leave is chosen (a draft is deleted, section 41.7 rule 15); an element with data-leaves-page (the phone back arrow) is caught like a link, and on phone Leave waits for the warning to close so it moves exactly one screen. useAnyUnsavedChanges tells the new-version banner a form is changed; leavingLink is the one link test. |
| tooltip.tsx | 400ms hover label (section 19). Never clickable, never the only source of a fact. Never opens on phone; disabledReason, used only by permission-tooltip.tsx, is the one exception (section 41.8 rules 16 to 18). |
| truncate.tsx | The truncate and clamp behaviours of section 8, with a tooltip only when the text is actually cut. On phone no tooltip opens: the screen one tap away shows the full text (section 41.8 rule 18). phoneLines={2} clamps to two lines (row names, banner sentences); SHOW_MORE_LINK is the one "Show more" style. |
| view-switcher.tsx | The list page view switcher (sections 11.1 zone 2, 11.6, 35.1 to 35.3): list, card, and board where the record type has one, as a joined group. useListView remembers the choice per list and shows the list whenever a remembered board cannot be shown. |

Anything added to components/ui is added to this table, and rendered on /kitchen-sink, in the same commit (section 6.4).

### 4.1.1 v2e additions

Capabilities this product added to a kit component, under section 4 rule 4 (a variant on the existing file, never a second component). Kept here so the next product built from this kit can see what moved from "v2e adapter" to "kit feature" and decide whether to carry it forward.

| File | Capability added | Why |
|---|---|---|
| calendar.tsx | `markedDates` (ISO yyyy-MM-dd strings or a Set) and `markedHint`: flags a day with a small dot and, when `markedHint` is given, a tooltip on it. | v2e's task deadline calendar flags a selected assignee's leave days. Implemented as a `DayButton` variant (`data-marked`), not a new component. |
| date-picker.tsx | `min`/`max` (Date): bounds the pickable range, passed through to `calendar.tsx`'s `disabled` matcher. `markedDates`/`markedHint`: passed straight through to `calendar.tsx`. | Needed by `components/ui/DatePicker.tsx`'s adapter (the product's ISO-string date field, ~28 call sites) to keep its existing `min`/`max`/`markedDates`/`markedHint` props working unchanged. |

`components/ui/DatePicker.tsx`, `DateRangePicker.tsx` and `TimeField.tsx` are this product's own adapters over `date-picker.tsx`/`calendar.tsx`/`time-picker.tsx` (ISO-string and `"HH:MM"` value contracts instead of `Date`/`TimeValue`); see `components/ui/ADAPTERS.md` for what each keeps and what it deliberately drops (`compact`, `hideClear`, `bare`, the old analog-clock dialog).

**On phone.** Each shared component switches to its phone form itself, through useLayout() (section 41.3 rule 4); its caller never chooses. Built: select, searchable-select, multi-select, inline-choice, dropdown-menu and popover become bottom sheets, or steps inside one (section 41.8); dialog becomes a bottom sheet when small and a full-screen layer when medium or large (rule 10); alert-dialog stays centred; date-picker and time-picker open the phone's own picker (section 41.9 rule 10); tooltip shows only disabled reasons (rules 16 to 18); sonner follows rules 12 to 14. Truncate clamps to two lines in phone rows. Phone-only parts (phone-list, action-bar, record-summary, approval-select and the like) are different: the screen chooses them, with useLayout(), as its phone arrangement (section 41.3 rule 2).

**lib/utils.ts** is part of the same contract. Its cn() function is extended with this project's type-scale token names. Without the extension, tailwind-merge treats a class such as text-label as a colour and silently drops the font size. Anything added to the type scale in globals.css is added to the extension in lib/utils.ts in the same commit.

A type-scale token never shares a name with a colour token. Both surface through the same text-* utility and nothing later can tell them apart. This is why the card heading token is --text-card-heading and not --text-card, which would collide with --color-card.

**Pending: specified in this file, not yet built**

When a rule is agreed before its component exists, add its row here the same day. Keep this heading.

| File | What it will be |
|---|---|
| permission-grid.tsx | The role editor's grid for one module (section 40.3): sections down, actions across, a tick and a scope in each cell, partly ticked module and row ticks, the "Also includes" line for Picks (section 40.5), and a read-only form. |
| action-bar.tsx | The phone's bar fixed at the bottom of a record or form (sections 41.6, 41.7): at most two buttons sharing the width, padded by the bottom safe area, sitting above the keyboard while it is open. It shares SheetFooter's action-bar form (section 41.6 rule 7) and carries data-fixed-bottom="action-bar". |
| unit-picker.tsx | The selected-units tick list on a person's access page (section 40.7): every unit, grouped where the product groups them, with partly ticked group ticks, the "8 of 48" counts, and search above 50 units. Not SearchableSelect or MultiSelect: those keep their options in a menu, and this shows every unit at once, with group ticks. |

**Not yet in this kit, and not component work:** sending phone notifications from the backend (section 41.12 rule 2: needs a server library, agreed first); five of the seven components/templates page shapes: list, detail, form, dashboard and settings. Ask before building anything that stands in for them. Built, outside components/ui, each with a demonstration route under /demo: components/shell, the shell of section 12 (app-shell, sidebar, top-bar, content-area, progress-bar, notification-panel) and the phone shell of section 41.4 (app-bar: PhoneAppBar, the fallback AppBar, BackButton, AppBarProvider, useAppBarState, useAppBarOverride; page-header: PageHeader, the one way a page gives its title, parent and actions; a page with a breadcrumb gives PageHeader its trail, from which the desktop breadcrumb and the phone back arrow's parent both come, and never renders Breadcrumb itself; tab-bar; more-screen; phone-nav: phoneDestinations), with lib/back.ts (useBack, section 41.4 rule 7) and the demo routes /demo/shell/my-work and /demo/shell/more, and components/templates/sign-in-page.tsx (section 11.7) and error-page.tsx (section 11.8). Built, outside components/ui, shown in the "Phone foundation" section of /kitchen-sink: lib/layout.ts with useLayout() and LayoutProvider, lib/layout.server.ts with the server's first guess, and lib/layout-shared.ts with the names both read (section 41.2); lib/keyboard.ts, the one keyboard hook (section 41.13 rule 6). Built for phone screens: lib/drafts.ts (useDraft, clearDrafts: section 41.7 rules 12 to 15), lib/field-keyboard.ts (fieldKeyboard, usePhoneEnter: section 41.7 rules 5 and 6) and lib/list-address.ts (useListAddress: a list's search, filters and sort in the address), with the demo screens /demo/shell/customers (list, record, add, edit, comments) and /demo/shell/orders (approvals, order record). Built in components/templates for phone screens: my-work-page (section 41.15), notifications-page (41.12 rules 1 and 6), search-page (41.4 rule 5; lib/recent-records.ts keeps the last 10 records opened), personal-settings (41.18: PersonalSettings, NotificationChoices), computer-only-page (41.11: ComputerOnly, ComputerOnlyPage), and sign-in-page's methods prop (email, otp or both: 11.7, 41.17). components/shell/phone-only.tsx (PhoneOnly) and lib/layout.server.ts's redirectOnDesktop send a phone-only address to its desktop page (41.2 rule 5); lib/validation.ts holds the one email and mobile checks; lib/format.ts the section 18 formats, its time zone, month names and currency symbol set once. lib/permissions.ts, lib/permissions.server.ts and the generated lib/permission-keys.ts are section 26.3 to 26.6 (a product's backend writes the keys with npm run access:keys; the kit's come from _kit-only/permission-keys); the sidebar, tab bar and More are filtered by permission; demo route /demo/shell/permissions. Demo routes: /demo/shell/my-work, notifications, search, me/** and settings (computer-only on phone), and /demo/sign-in-otp. The installable app (sections 41.12, 41.14), phone only, its head tags sent only when the server guesses phone: app/install-manifest (the manifest) and app/install-icon (the icons, drawn from the product's mark) with the install colours in lib/install-settings.ts, edited with the brand block; lib/install.ts and components/shell/install-sheet.tsx (More's Install app row); public/sw.js, lib/service-worker.ts and app/offline (the hand-written service worker and the offline screen); lib/push.ts and public/sw-push.js (the phone's side of notifications).

### 4.2 Which React actually runs

- The host decides which React runs, not package.json. Next vendors its own React and the App Router uses it, so the installed react version never reaches the browser. On a host that does not vendor React (Vite, Create React App, an older Next), the installed version is the one that runs.
- This kit therefore declares no supported React range. For each product, ask what will actually execute on its host.
- These components are written against React 19. React 19 passes ref to a function component as an ordinary prop; React 18 does not, unless the component uses forwardRef. Every Base UI part that takes render={<SomeComponent/>} passes a ref, so this matters. button.tsx uses forwardRef for this reason. Do not remove it.
- A product running React 18 must verify every component that a Base UI part wraps or that it attaches a ref to. A component without forwardRef is not proven safe on React 18; unproven is not the same as safe.
- A clean build and a mounted screen are not proof that anything works. A ref fault shows only on interaction: a popup reports itself open while nothing appears on screen. Operate every control and every state on the runtime that will actually run.
- _kit-only/react-compat-harness/ checks runtime behaviour. It runs these components on React 18.3.1 and React 19 in a bare Vite app and reports whether refs resolve and whether each control opens and positions. It does not check appearance, because it has no Tailwind. The kitchen sink under Next checks appearance. Neither replaces the other. If a behaviour is the same on both runtimes, it comes from the harness, not from a defect.

### 4.3 Pinned dependencies

- @base-ui/react is pinned at exactly 1.8.0, with no caret (^). It makes breaking changes in minor releases (1.8.0 removed about 69 exports), and a caret would give each new product a version nobody verified.
- sonner is pinned at exactly 2.0.8 for the same reason: sonner.tsx's Undo protection on phone (section 41.8 rule 13) reads how it stacks and removes toasts, which a minor release may change. The upgrade order below applies to it too, with the phone check _kit-only/phone-checks/undo-toast.js in place of the harness.
- A pinned package never updates on its own, including security patches. An upgrade is a planned task with an owner, done only when asked, in this order:
  1. **Compare the versions.** For every part the kit uses, check whether any data attribute, role or imported export was removed or renamed.
  2. **Run _kit-only/react-compat-harness on both runtimes** (npm run dev:18, then npm run dev:19). Refs must resolve, and every control must open and position against its trigger.
  3. **Run /kitchen-sink on the new version.** Check the data-attribute state styling and sweep the state matrix. A renamed attribute does not error; it silently stops matching.
  4. **Pin the new version** with --save-exact.
- The order matters: the harness fails loudly and cheaply, the kitchen sink catches the quiet failures, and the pin then records a verified version.

## 5. Spacing, radius, borders, depth and motion

### 5.1 Spacing scale

Only these values may be used.

| Token | Value | Used for |
|---|---|---|
| space-1 | 4px | Icon to its label |
| space-2 | 8px | Tightly related items, chip padding |
| space-3 | 12px | Inside small components |
| space-4 | 16px | Card padding, standard gap |
| space-6 | 24px | Between distinct blocks inside a section |
| space-8 | 32px | Between sections on a page |
| space-12 | 48px | Above a major section heading, page top margin |

There is no space-5, space-7 or space-9. If 16 feels too small and 24 too big, the answer is one of those two. Never 20.

### 5.2 Grouping

- Space belongs above an element, not below. A heading pushes down from what came before it, so it stays attached to its own content.
- Related items sit closer than unrelated ones. A form label sits 8px (space-2) above its input, and 24px (space-6) below the previous field. That difference tells the eye which label belongs to which box.

### 5.3 Radius and borders

- 8px: buttons, inputs, badges, small controls.
- 12px: cards, dialogs, panels.
- 4px (--radius-tick): tick boxes only. A 16px square at 8px radius looks like a radio button. Used nowhere else.
- Fully rounded (half the height): count pills (section 6.8), scrollbar thumbs (section 10.1), the bottom sheet's drag handle (section 41.8 rule 3) the phone list's round add button (section 41.5 rule 7) and the notification unread dot (section 41.12 rule 6). Nothing else.
- No other radius values.
- Borders are 1px, with three exceptions, all 2px in primary: the active tab accent (section 33.3), the rule above a report total row (section 34.1), and the bottom rule of an inner header band's accent form (section 36.4). No other border is thicker than 1px.


### 5.4 Shadows

A shadow means one thing: this surface floats above what is beneath it. There are three levels and no others.

| Token | Strength | Used for |
|---|---|---|
| --shadow-card | Very faint | Cards (with their 1px border) |
| --shadow-menu | Medium | Dropdown menus, select lists, popovers, tooltips, the date and time picker popups, the phone list's floating add button (section 41.5 rule 7) |
| --shadow-dialog | Strongest | Dialogs, alert dialogs, sheets, a card being dragged |

Rules:

1. All three are defined in globals.css and derived from --text-primary, like --backdrop (section 24). They are never tinted with the brand or a status colour.
2. Nothing that sits flat on the page has a shadow: table rows, buttons, inputs, badges, header bands, the sidebar and the top bar.
3. A clickable card (card view, board card) rises from --shadow-card to --shadow-menu on hover. This is the only shadow that changes on hover.
4. Never write a box-shadow value outside globals.css.

### 5.5 Layers

What sits on top of what is fixed. From bottom to top:

| Order | Token | Holds |
|---|---|---|
| 1 | (none) | Page content |
| 2 | --z-sticky | Sticky table headers, pinned total rows, frozen columns, board column headers |
| 3 | --z-shell | Sidebar and top bar; on phone, the app bar, tab bar and action bar |
| 4 | --z-dialog | Dialogs, alert dialogs, sheets, and their backdrop |
| 5 | --z-popover | Dropdown menus, select lists, popovers, date and time picker popups |
| 6 | --z-toast | Toasts |
| 7 | --z-tooltip | Tooltips |

Rules:

1. Menus sit above dialogs, because a dropdown inside a dialog's form must open on top of the dialog.
2. Toasts sit above dialogs, so a confirmation is never hidden behind the dialog that caused it.
3. Tooltips sit above everything, because a tooltip can be opened from any layer.
4. Every floating layer (menus, popovers, tooltips, dialogs, sheets, toasts) renders in a portal at the end of the page, never inside the element that opened it. That way no parent's overflow or layer can clip it.
5. Use only these tokens. Never write a z-index number outside globals.css.

### 5.6 Motion

Motion shows where something came from and where it went. It is quick, quiet and the same everywhere.

**Durations and easing**

| Token | Value | Used for |
|---|---|---|
| --duration-fast | 150ms | Hover and pressed colour changes, tooltips |
| --duration-medium | 200ms | Menus, select lists, popovers, picker popups, toasts |
| --duration-slow | 250ms | Dialogs, sheets, the sidebar opening and closing |
| --ease-enter | cubic-bezier(0.2, 0, 0, 1) | Anything appearing |
| --ease-exit | cubic-bezier(0.4, 0, 1, 1) | Anything disappearing |

- Things disappear faster than they appear: an exit uses the next shorter duration (slow exits at medium, medium at fast, fast at fast).
- Never write a duration or easing value outside globals.css.

**What moves, and how**

| Element | Motion |
|---|---|
| Hover and pressed states | Background colour only, fast (see the transition-colors trap in section 6.4) |
| Focus ring | Never animated. It appears instantly |
| Menus, select lists, popovers, picker popups | Fade in with a 4px slide away from the trigger, medium |
| Tooltips | Fade only, fast, after the 400ms delay (section 19) |
| Dialogs | Fade in with a slight scale from 98% to 100%, slow. The backdrop fades with it |
| Sheets | Slide in from their own edge, slow |
| Toasts | Fade in with a slide up from the bottom edge, medium |
| Sidebar collapse and expand | Width change, slow. The content area follows |
| Skeletons | A soft, slow pulse |
| A dropped board card | Settles into its column, medium |
| Bottom sheet, on phone | Slides up from the bottom, slow. Follows the finger while dragged down |
| Swipe dismissal, on phone (toast, notification row) | Follows the finger, then slides out, fast |
| Pull to refresh, on phone | The loading bar above, nothing else |
| Phone list's search, count line, banner and chips (section 41.5) | Slide back in from the top on a small scroll up, medium |
| Full-screen dialog layer, on phone (section 41.8 rule 10) | Fades in, slow. No slide or scale |

**What stays still**

- Tab switches, sorting, filtering and pagination. When the new content is ready, it replaces the old in one step.
- Numbers. A figure appears at its final value.
- The phone list's add button. It appears and disappears at once, with the keyboard and select mode (section 41.5 rule 7).
- The table above is the complete list of motion in this system. A button that is saving shows no moving indicator: its words, "Saving", say so (section 14 rule 2).

**Page changes and slow loads**

1. While the next page loads, the current page stays on screen.
2. If loading takes longer than 300ms, a progress bar appears: full width of the content area, directly below the top bar, --spacing-progress (3px) tall, in primary-text, at --z-shell. It advances from left to right while loading, completes when the page is ready, then fades out at the fast duration.
3. Once visible, the bar stays for at least 500ms, even if loading finishes sooner.
4. A load under 300ms shows nothing. The user experiences it as instant.
5. When the new page is ready, it replaces the old one in one step. If its data is still arriving, its skeleton shows first (section 14 rule 1).
6. The same bar and timing apply when a list reloads after a search, filter, sort or page change. The current rows stay on screen until the new ones arrive.

**Rules**

1. Animate only opacity and transform. Never animate height, width or position of content the user is reading, because it shifts the text under their eyes. The sidebar width (above) is the one exception.
2. Motion never delays the user. A menu is usable the moment it starts opening, and a click during an animation is never ignored.
3. **Reduce motion.** When the user's device has "reduce motion" switched on (prefers-reduced-motion: reduce), remove all sliding and scaling. Keep simple fades at the fast duration, stop the skeleton pulse, change the sidebar width instantly, and show and hide the progress bar with a fade only.

## 6. Buttons

### 6.1 Hierarchy

| Level | Appearance | Used for |
|---|---|---|
| primary | Filled with primary, text in primary-foreground | The one main action |
| secondary | White fill, 1px primary-border border, text and icon in primary-text | All other actions with a text label |
| ghost | No fill, no border at rest; the quiet icon button (section 6.3) | Icon-only buttons |
| danger | Filled with danger, white text | Delete and irreversible acts |

Rules:

1. Exactly one primary button per screen or per dialog. The one exception is the settings page (section 11.5).
2. Every other button with a text label is secondary. Secondary text and icon are primary-text, so the brand appears on every button while the one filled primary button still stands out.
3. Secondary hover is a surface-control fill; pressed is surface-control-pressed. Never use primary-subtle for a button fill: that colour means "selected".
4. Icon-only buttons are quiet everywhere: no fill and no border at rest (section 6.3). Their icon, tooltip, hover fill and focus ring make them readable as controls.
5. A button with a text label always has a visible fill or border. A word with neither reads as plain text or a link, and people stop seeing it as something to click.

   Five text controls are the exception: calendar day cells, which are grid cells, not buttons (section 20.1); pagination controls (section 11.1.1); "Show more" at the end of clamped text (sections 6.6 and 8); inline text controls inside a sentence (section 6.7); and a tappable row on phone (a list row, a More row, a related-record row, a notification or a search result), which is a whole-row link, not a button.

### 6.2 Fixed sizing

Height is fixed. Width grows with the label. Height never does.

- Default button: exactly 36px tall.
- Small: 32px. Large: 40px. No other heights.
- Icon-only button: exactly 36 by 36px.
- Exception: an icon button inside a 36px field is 32 by 32px (icon-sm), because a 36px button cannot fit inside a 36px field. Used by date-picker, time-picker and password-input.
- These are visible sizes. On touch screens, the tap area grows to 44 by 44px without changing what the user sees (section 9 rule 4).
- The phone layout makes these controls 44px tall visibly (section 41.9).

### 6.3 Icon buttons

An icon-only button (in a toolbar, page header, card or table row) is quiet: no fill and no border at rest. Its clickable area is still the full 36 by 36px. Use the ghost variant.

| State | Treatment |
|---|---|
| resting | No fill, no border, icon in text-secondary |
| hover | surface-control fill behind the icon, icon to text-primary |
| pressed | surface-control-pressed fill |
| disabled | Icon to text-muted, no fill, pointer cursor removed |
| focus | primary-ring outline, fully visible |

Rules:

- The one exception is the single main action in a toolbar, which may be a filled primary icon button. A delete icon button is quiet like the rest; the danger colour belongs to its confirmation dialog (section 15).
- Every icon-only button carries a hidden text label for screen readers and shows a tooltip on hover.
- Exception: the close button (x) in a dialog corner needs no tooltip. Its meaning is clear from its shape, and Escape and the backdrop do the same thing. It keeps its hidden text label.

### 6.3.1 Icon button inside a field

An icon button inside an input, select or any other bordered field takes the same quiet treatment as section 6.3, with one difference: its focus ring is inset, so the field does not clip it. Examples: the calendar trigger on date-picker, the clock on time-picker, the eye toggle on password-input, a clear button inside a search box, and anything added later that sits inside a field.

| State | Treatment |
|---|---|
| resting | No fill, no border, icon in text-secondary |
| hover | Subtle surface-control tint behind the icon, icon to text-primary |
| pressed | surface-control-pressed tint |
| disabled | Icon to text-muted, no fill, pointer cursor removed |
| focus | primary-ring outline, fully visible, inset so the field does not clip it |

The focus ring is required. It is the only way a keyboard user can tell that focus is on the button and not in the text.

Use the in-field variant of button, which carries the inset ring. Do not hand-roll these states.

### 6.3.2 Icon button on a header band

An icon button on a section 36 header band is quiet like every icon button, but its colours are reversed for the brand ground. Examples: the three-dot menu on a card header, the close button in a dialog corner, a column menu on a board.

| State | Treatment |
|---|---|
| resting | No fill, no border, icon in on-brand |
| hover | on-brand-hover behind the icon |
| pressed | on-brand-pressed |
| disabled | Icon to on-brand-muted, no fill, pointer cursor removed |
| focus | 2px ring in on-brand, inset so the band does not clip it |

The focus ring uses on-brand, not primary-ring. primary-ring is a shade of the brand and is nearly invisible on a primary ground.

Use the on-brand variant of button. Do not hand-roll these states and do not use ghost.

### 6.4 States

**What every control defines**

- Every interactive element defines four states: resting, hover, pressed, disabled. Disabled reduces contrast and removes the pointer cursor.
- Keyboard focus shows a visible ring in primary-ring. Never remove the focus outline.
- Controls that are pressed (a button, a menu trigger, a tab, a tick box, a row action): hover changes the background, and pressed changes it further.
- Controls that take typed text (an input, a textarea, a search field, the text half of a combobox) are focused, not pressed. Their background never changes on hover or while typing. They define resting, hover, focus, disabled and invalid. Hover moves the border only. Reason: the pointer often stays over a field while the user types, so a hover fill would become how the field looks the whole time it is in use.
- Never put transition-colors on an element whose focus ring comes from a has-[:focus-visible] rule on that element, such as a whole-card click target (section 11.6). transition-colors also animates outline-color, so the ring stays in the text colour (black) instead of primary-ring. Use transition-[background-color] instead. A control that takes its ring through focus-visible: on itself, such as a button, is not affected.

**The state matrix on /kitchen-sink**

The kitchen sink replays hover, pressed and focus through [data-force] rules in globals.css. It can mislead in two ways:

1. **A control with no forcing rule** shows its resting look in the hover column, which looks like success. state-matrix-check.tsx catches this. It compares every interactive element in a forced cell against its resting twin and shows a danger panel naming any that are identical. Silence is the pass. It ignores parts that inherit their control's states, such as a tick glyph, a switch knob or the text inside a select trigger.
2. **A forcing rule over a component that has no real states** shows a state no user can ever see. No automated check catches this. So a forcing rule is added to globals.css only in the same commit as the matching hover and active classes in the component.

Further rules:

- When a check reports a mismatch, decide which side is wrong before fixing anything. A check tells you two things disagree, not which one is at fault.
- Test the check once before trusting it: delete one control's forcing rule, confirm the panel names exactly that control, then restore it.
- A forcing rule is keyed on the element and the variant, not on data-slot. A Base UI trigger given render={<Button/>} keeps its own slot (for example, dropdown-menu-trigger), so write button[data-variant="ghost"], not [data-slot="button"][data-variant="ghost"].

**Kitchen sink coverage**

A component that is never rendered on /kitchen-sink is unverified. Every component in components/ui is rendered there (section 4.1), used the way section 4.1 describes. Where a component needs a parent, the parent is part of the example. A part with a required parent throws during render, so a kitchen sink page that loads at all proves every required parent on it is correct.

Which React runtime a product executes is a separate check (section 4.2).

### 6.5 Composite controls

A composite control is a field with an icon, a field with a clear button, or any input group.

- One element owns the border, the radius and the height. Everything else sits inside it.
- An inner element sizes from the wrapper with h-full, never h-control. The wrapper's h-control already includes its border and leaves 34px inside, so an inner child at h-control is 2px too tall and paints over the border.
- A state fill (hover, pressed) is painted by the outer element, never by a child. A child has its radius removed to sit flush, so its fill shows as a sharp rectangle. bg-transparent on a child sets only its resting fill and does not cancel its hover or pressed fill. Use the has-[...] and group-* selectors on the outer element.
- Fix the container; do not mute the child. A child told to be invisible is a hidden defect, not a fixed one.

### 6.6 Text links

**A link goes somewhere; a button does something.** A link takes the user to another page, a record, a file or another website. Anything that saves, deletes, submits or opens a dialog is a button (section 6.1).

| Where | Appearance |
|---|---|
| Standing on its own ("Forgot your password?") | primary-text, body weight. Underline on hover |
| Inside a sentence or paragraph | primary-text, always underlined |
| A record's name in a table row (section 11.1.2) | text-primary, like the rest of the row. Underline on hover |
| On a brand band or the sign-in brand panel | on-brand, always underlined |

Rules:

1. Keyboard focus shows the primary-ring outline, like every control (section 6.4).
2. A visited link looks the same as an unvisited one.
3. A link to another website opens in a new tab and carries the external-link icon (section 23.1) after its text.
4. A link with nowhere to go is shown as plain text. The one exception is a pagination control (section 11.1.1).
5. "Show more" (section 8) expands text in place, so it is a button, styled as a standing link.

### 6.7 Inline text controls

An actionable element inside a sentence (for example, the number in "Show
25 records per page") is an inline text control. It reads as part of the
sentence:

- The same font size, weight and line height as the text around it.
- Text in primary-text, underlined.
- A control that opens a choice ends with a 12px chevron-down icon.
- It opens its menu or popover in the normal way (section 16), and keeps
  the focus ring (section 6.4) and tap area (section 9 rule 4) of every
  control.
- Its menu is at least as wide as its trigger, and as wide as its widest option. This is the one exception to the width rule of section 16.2.
- The one use outside a sentence is the scope beside a tick in the permission grid (section 40.4). It is a value in a table cell, and a select at the 160px field minimum (section 17 rule 1) in every cell would make the grid several screens wide. Every other rule in this section still applies.

### 6.8 Counts inside controls

A count inside a button, tab or menu item (for example, the number of
active filters) is a small pill that stays quieter than the label beside
it.

| Property | Value |
|---|---|
| Text | 12px, weight 500, primary-foreground |
| Fill | primary |
| Height | 18px, fully rounded |
| Width | One character: an 18px circle with no side padding. Two or more characters: 6px side padding. The one value outside the spacing scale (section 1 rule 9): 8px makes a two-digit pill look like a lozenge |
| Gap from the label | 8px (space-2) |

- The same count style is used in every control: buttons, tabs and menu
  items.
- A count over 99 shows as "99+".
- Counts appear on secondary buttons, tabs and menu items.
- A count on a header band (for example, a board column total) is plain text in on-brand-muted (section 36.8).

## 7. Messages and notifications

### 7.1 Choosing the right place

| Pattern | Used when |
|---|---|
| Toast | Confirming an action the user just took. Temporary. |
| Inline field error | A specific form field is wrong. |
| Banner | A condition that persists until resolved (section 7.5). |
| Dialog | The user must act. Destructive or irreversible. |

The deciding question: can the user ignore it and carry on? Yes and temporary means toast. Yes but it stays true means banner. No means dialog. About one field means inline.

Never use a toast for a field validation error. The user has to remember which field was wrong after it vanishes.

### 7.2 Rules

1. Every status message carries an icon as well as a colour. Colour alone is invisible to colour-blind users.
2. Error text states the cause, then the next action. "Enter a complete email address, like name@company.com", not "Invalid email".
3. No exclamation marks. No "Error:" prefix. No "Oops". Never show a raw technical error message to a user.
4. All screen text also follows section 37.

### 7.3 General notifications

A notification such as "Rakesh assigned you a task" is neutral. It is neither success nor failure.

- Notifications are neutral by default: grey text on a plain surface.
- The brand colour is used only for the unread dot and a faint row tint.
- A status colour appears only when the item is genuinely a success, warning or failure, and then only as a small badge inside the row. The row itself stays neutral.
- General notifications belong in the notification centre (bell icon), not in toasts or banners. Toasts and banners are about the current screen. Notifications are about events elsewhere in the system.

### 7.4 Notification centre

- On phone, notifications are a screen of their own instead (section 41.12).
- Clicking the bell opens a panel (popover.tsx) below it, 360px wide, at --shadow-menu.
- The panel header reads "Notifications", with "Mark all as read" on the right.
- It lists the latest 25 notifications, newest first. Each row shows what happened ("Rakesh assigned you a task"), and when, in "2 hours ago" style (section 18), with the unread dot and row tint of section 7.3.
- Clicking a notification marks it as read, closes the panel and opens the item it is about.
- The panel footer holds "View all", a link to a notifications list page built on the list page template (section 11.1).
- With no notifications, the panel shows one line in text-muted: "You are all caught up."
- Arrow keys move between notifications, Enter opens one, and Escape closes the panel.

### 7.5 Banners

A banner shows on every visit until its condition ends, so it says little.

1. **One line on a page.** A short message, with the count where there is one, and at most one action: "3 clients have no billing address", with "Review clients". The one exception is the draft banner (section 41.7 rule 13), with two: Use draft and Discard. A banner never lists records; they are on the page its action opens. Text that does not fit truncates (section 8) and never wraps. On phone it may wrap to two lines (section 41.8 rule 15).
2. **Inside a form or dialog**, such as the failed sign-in of section 11.7, a banner is read whole, so it may wrap. It is still one message, never a list.
3. **A warning or neutral banner that reports a condition in the data can be closed.** The close is a quiet x icon button at the end of the line (section 6.3), with the tooltip "Close". It is remembered for that person in that browser, per condition, and the banner returns only if the condition gets worse, such as its count rising. If the browser's storage cannot be read, the banner shows.
4. **A banner that explains why something cannot be done is never closed**: a locked record (section 38.3), permissions that failed to load (section 26.1), a role that cannot be changed (section 40.3), an inactive person (section 40.9). Closing it would leave that unexplained.
5. **At most one banner on a page.** When two conditions hold at once, one that explains (rule 4) shows before one that reports (rule 3), and otherwise danger before warning before neutral. The other shows once the first is resolved or closed. A banner the shell shows above the page, such as permissions that failed to load (section 26.1 rule 5), counts toward this limit.
6. **What a save just did is a toast, not a banner** (section 7.1), even when the save changed other records too.

## 8. Text overflow

Text must never overflow its container. Every text element uses one of three behaviours.

| Behaviour | Where |
|---|---|
| Truncate | Table cells, list rows, chips, menu items, buttons |
| Wrap | Detail pages, dialog bodies, form helper text |
| Clamp | Card descriptions, notification rows, previews |

- **Truncate** means one line ending in three dots, with the full text in a tooltip on hover.
- **Truncation needs a bounded width.** In a table, a column with no declared width sizes itself to its longest value. A long value then either pushes the table wider than its container or squeezes every other column. Fix it with section 17.1 column widths, not with a class on the cell.
- truncate.tsx renders its text in a min-w-0 block, so a long value does not widen its column. This protects only columns that use it; a cell written as plain text still sizes from its content.
- **Clamp** means stopping at two lines with a "Show more" link. Notification rows clamp at two lines with no "Show more": the full text is on the item the row opens.
- Cards in a grid must all be the same height. Clamping is how this is achieved.

## 9. Responsive behaviour

Supported range: desktop, tablet and phone. Phones have their own layout (section 41); the table and rules below are for the desktop layout.

| Name | Width | Behaviour |
|---|---|---|
| Desktop | 1280 and above | Full layout. Sidebar open. All columns shown. |
| Laptop | 1024 to 1279 | Sidebar collapses to icon rail. Grids go from 4 to 3 columns. |
| Tablet | 768 to 1023 | Sidebar behind a menu button. Grids go to 2 columns. |
| Phone | Shorter side of the screen under 600 | The phone layout (section 41). |

Rules:

1. Check every screen at 1280, 1024 and 768 pixels before it is considered done.
2. Layout widths are proportional, never fixed pixels. A two-column area is two equal fractions of the available space, not two 400px boxes.
3. Any grid or flex column containing text must be allowed to shrink below its content width. Without this, a long word or unbroken number pushes the whole layout wider than the screen. This is the most common cause of broken layouts.
4. Touch targets are at least 44 by 44px on touch screens. A control keeps its visible size (section 6.2); only its tap area grows, through an invisible extension around it (for example a ::after element), applied under @media (pointer: coarse). Never make the control itself taller. Controls sit at least 8px (space-2) apart, so extended tap areas never overlap.
5. Any device in the desktop layout narrower than 768px (a narrow browser window, a small tablet) keeps the desktop layout. It must remain usable and must never break, overlap or push content off screen.
6. Phones get their own layout, designed fresh for the work people do on a phone (section 41), never made by shrinking desktop screens. Phone screens are checked by section 41.20.
7. Below 1024px the sidebar is hidden by default. The same toggle then opens it as an overlay sliding over the content, instead of pushing the content sideways. Build both behaviours.

## 10. Scrolling

1. Vertical scroll is the default and always allowed.
2. Horizontal scroll is a last resort. First drop low-priority columns at narrower widths. Only a genuinely wide table, such as a ledger with more than eight columns at desktop width, may scroll sideways, and then its first column is frozen. The data entry grid (section 31.4), the board (section 35.8) and the permission grid (section 40.3) are the other three exceptions, because every one of their columns is essential. A screen where a column can be dropped must drop it instead.
3. Never nest a scrollable area inside another on the same axis (section 1 rule 8).
4. Every table declares which columns are essential, which are secondary (hidden below 1024px) and which are tertiary (hidden below 768px), and declares their widths (section 17.1). These are one decision: a column with no declared width takes space from whatever columns remain.

**Scroll ownership, by screen type**

- List page: the data area owns the scroll. The page itself does not scroll.
- Detail page: the page owns the scroll. Individual cards do not.
- A card scrolls internally only when it is a fixed-height live feed, such as an activity list or chat thread.

### 10.1 Scrollbar styling

The browser default scrollbar is never used.

| Part | Value |
|---|---|
| Track | #F0F4F3 |
| Thumb | #A8BDBA |
| Thumb hover | #7D9895 |
| Width | 10px, fully rounded |

The three colours belong to the current product and are replaced with the brand block (section 0.1). The width belongs to the system. The tokens are --scroll-track, --scroll-thumb and --scroll-thumb-hover.

**How a new product derives the three colours**

| Part | Hue | Saturation | Lightness |
|---|---|---|---|
| Track | primary's hue | 15% | 95% |
| Thumb | primary's hue | 14% | 70% |
| Thumb hover | primary's hue | 12% | 54% |

- Keep the primary's hue exactly. Set saturation and lightness to the fixed values above. Never scale them from the primary's own saturation or lightness, or a very bright or very pale brand gives an unusable scrollbar.
- This applies to every brand, including very light or very dark ones: take the hue only.
- The shipped values are this rule applied to the current primary. Apply the rule to a new primary; do not copy hex values from another product.
- If a brand is so grey that the result looks plain grey, that is correct.

**What to check.** There is no contrast rule for a scrollbar, because it carries no text. Check only that the thumb is visibly darker than the track, and the track is visibly different from the surface behind it. For reference, the shipped values measure a colour difference (CIEDE2000, see section 21.1) of 15.4 thumb against track, 11.5 hover against thumb, and 3.2 track against surface.

## 11. Page templates

Almost every screen is one of six types: list, detail, form, dashboard, settings, sign-in. Use the matching template. Do not invent new arrangements. Error pages have their own fixed design (section 11.8).

### 11.1 List page

Four fixed zones, always in this order. Only zone 3 scrolls. Optional zones 1a and 1b may sit between the header and the toolbar.

1. **Header.** Page title on the left, one primary action button on the right. Record count as meta text under the title. Does not scroll.

   1a. **Section tabs.** Optional (section 33). Does not scroll.

   1b. **List banner.** Optional. At most one banner (section 7.1) about the list as a whole: a condition across its records that stays true until someone fixes it, such as "3 clients have no billing address". It sits below the section tabs and directly above the toolbar, and does not scroll.
   - It is one line (section 7.5): the count, and one action that shows the records concerned. It names no records; the action's page does. It reports the condition; it does not fix it in place.
   - It takes the status colour of what it says (section 2.4), usually warning. It can be closed, and returns if the condition gets worse (section 7.5 rule 3). It goes for good when the last record is fixed.
   - The server decides whether the condition holds and sends the list. The browser does not work it out.
   - It is never a hint, a tip or a promotion. Those are not conditions.

   Zones 1a and 1b are the only things allowed between the header and the toolbar.
2. **Toolbar.** Search on the left, at a fixed 280px width (--spacing-search). Filter and sort as secondary buttons beside it. View switcher (list and card, plus board where section 35.2 allows) on the far right as a joined group, with the active side tinted primary-subtle. Does not scroll.
3. **Data area.** The only scrolling zone. Fixed height, calculated from the window height. Column headers stay visible while rows scroll. Holds the list, the card grid (section 11.6) or the board (section 35): three arrangements of the same records under the same filters.
4. **Pagination.** Record count on the left, page controls on the right. Does not scroll.

Rules:

- Default page size is 25 records.
- Numbers are right-aligned. Text is left-aligned.
- Status is always a badge, never plain coloured text.
- Zones 1, 1a, 2 and 4 stay neutral, and zone 1b takes only its status colour (section 36.6). The section 36 brand band belongs to the table inside zone 3, not to the page around it (section 36.5).

### 11.1.1 Pagination (zone 4)

Zone 4 is a status line, not a toolbar. It carries no boxed controls. This is one of the five exceptions in section 6.1 rule 5.

- The count reads "1–25 of 148", not "Showing 1 to 25 of 148". Use an en dash, text-label in text-secondary, tabular figures, and never let it wrap.
- Previous, Next and page numbers have no fill and no border. They rest in text-secondary and move to text-primary on hover.
- The current page is body strong weight in primary-text, with no fill.
- The controls stay real focusable elements: an a where a page is a link, a button where it is not. They keep the 36px height and a 36px minimum width, and keyboard focus shows the primary-ring outline (section 6.4).
- A control with nowhere to go is aria-disabled, drops to text-muted and loses the pointer cursor.

### 11.1.2 Opening a record from a list

- Clicking anywhere on a row opens the record. There is no "Open" or "View" button in a last column.
- The record's name in the row is a real link (an a element with an href). That is how keyboard users reach it with Tab, how Enter opens it, and how "open in new tab" works. The row's click goes to the same address.
- Clicking the tick box, the three-dot menu or any other control inside the row does not open the record.
- Selecting text inside a row does not open it.
- On hover, the row shows a soft neutral fill and a hand cursor, so people can tell it is clickable.
- The three-dot menu (col-actions) appears only when the list has row actions other than opening, such as Edit, Duplicate or Delete.
- This applies to list tables only. Report tables (section 34) and data entry grids (section 31) are not records, and their rows do not open anything. Cards in card view and on a board are already clickable as a whole (sections 11.6, 35.5).

### 11.2 Detail page

1. **Breadcrumb.** The first element on the page. Reflects the structure of the software, not the user's history. Maximum three levels; if four are needed, the structure is wrong.
2. **Record header.** Record name as the page title, status badges beside it (never below), a supporting meta line underneath. On the right: one primary action (usually Edit) and a three-dot menu for everything else.
3. **Content.** Two columns on desktop: main content at two-thirds width, summary sidebar at one-third. The sidebar drops below the main content on tablet.
4. **Related records.** Tabs at the bottom for child records: invoices, tasks, documents, activity.

No back arrow buttons on desktop or tablet (the phone layout differs: section 41.4). A back button behaves differently depending on how the user arrived, which makes people feel lost. Breadcrumbs replace it.

### 11.3 Form page

1. Add and Edit use the same component (section 4).
2. Labels sit above their field. Never to the left, never as placeholder text inside the field.
3. Required fields carry a red asterisk on the label. Optional fields are not marked.
4. Fields are grouped into named sections with a section label.
5. Maximum two columns. Related fields sit side by side.
6. Validation runs when the user leaves a field, not on every keystroke. The error appears below the field and the field border turns danger red.
7. Actions sit in a footer bar, aligned right. Cancel on the left, primary on the right, always in that order.
8. A form with more than 12 fields uses a fixed footer, so the save button is always reachable.
9. Placeholder text shows an example format only. It is never the label.
10. **Unsaved changes.** When a user leaves a form with unsaved changes (by moving to another page, or closing a dialog or sheet with Escape, the backdrop or the close button), an alert dialog asks first. Its words depend on whether the record exists yet:
    - **Editing a record that exists.** Title: "Leave without saving?" Body: "Your changes to this client will be lost." Buttons: "Stay" (secondary, left) and "Leave without saving" (danger, right).
    - **Creating a record**, which exists only once submitted, so there is nothing to save. Title: "Leave this invoice?" Body: "What you have filled in will be lost." Buttons: "Keep filling" (secondary, left) and "Leave" (danger, right).
    - The one Add and Edit form (rule 1) uses the create words when adding, including Duplicate, and the edit words when editing.
    - A dialog that records an action, such as approve or reassign, is a create form: nothing is kept until it is submitted. Where the action has no natural noun, the title is "Leave this form?"
    - A form counts as changed only when its values differ from the saved ones. Typing and then deleting back to the original counts as no change, and the form closes without asking.
    - When the browser tab itself is closed, the browser shows its own warning. This is the one dialog in the system that is the browser's, because no website can style it.

### 11.4 Dashboard page

Four zones, top to bottom. A dashboard is read-only.

1. **Metric tiles.** A row of four. Each shows a label, one large number (in the short form of section 18.1), and a change indicator against the previous period.
2. **Main chart.** One chart, full width.
3. **Two panels side by side.** Usually items needing attention on the left, recent activity on the right.
4. **Nothing.** Dashboards end. They do not scroll for three screens.

Rules:

- No editing and no forms on a dashboard.
- Every tile links to the list page that explains its number.
- Every number states its period: "This month", "Last 30 days".

### 11.5 Settings page

- Two columns: a vertical menu of sections on the left at 200px (--spacing-settings-menu), content on the right.
- Each section is a set of cards, one card per group of related settings.
- Each card has its own Save button. Never one Save button for the whole page.
- Each card's Save is a primary button. This is the one exception to section 6.1 rule 1: each card works as its own screen, and a secondary Save reads as optional. Do not restyle these to secondary.
- Destructive settings, such as deleting an account, sit in a separate card at the bottom with a danger-coloured border.

### 11.6 Card view

The alternative to list view on a list page. Board view (section 35) is the third, and the rules below on card height, clamping and the whole card being clickable apply to board cards too.

- Cards in card view are record cards and have no header band (section 36.10).
- A card shows at most five pieces of information: title, status badge, two supporting facts, one meta line.
- All cards in a grid are the same height. Descriptions clamp to two lines to achieve this.
- Grid is 4 columns on desktop, 3 on laptop, 2 on tablet.
- The whole card is clickable, not only the title.
- Card view and list view show the same records with the same filters. Switching view changes appearance only, never content.
- The user's choice of view is remembered.

### 11.7 Sign-in page

In FRONTEND_RULES_ACCESS.md. Read that file before working on this.

### 11.8 Error pages

Three pages, each built from empty-state.tsx (section 13): an icon, a short heading, one explaining line and the actions below.

| Page | Heading | Line | Actions |
|---|---|---|---|
| Not found | Page not found | The link may be old, or the page may have moved. | Primary: "Go to dashboard" |
| No access | You don't have access to this page | Ask an administrator if you need it. | Primary: "Go to dashboard" |
| Something went wrong | Something went wrong | Try again. If it keeps happening, share the reference below with your support team. | Primary: "Try again". Secondary: "Go to dashboard" |

Rules:

1. For a signed-in user, the page appears inside the application shell (section 12), so the sidebar and top bar are still there to go elsewhere.
2. For a signed-out user, the page is centred on surface, with the product mark and name above it.
3. "Something went wrong" shows a reference code below the actions, in meta style: "Reference: 8F2K". The same code is recorded with the error on the server, so the support team can find the exact problem.
4. "No access" appears when someone opens a link to an area they hold no permission for (section 26.6). A record outside their scope is "Not found", not "No access" (section 26.6 rule 5).
5. empty-state.tsx gains the not-found and no-access variants for these pages.
6. On phone, "Go to dashboard" reads "Go to home" and opens My work (section 41.15). "Something went wrong" uses its existing failed variant.

## 12. Application shell

The shell is the frame every page sits inside. It never changes between pages. On phone, section 41.4 replaces it.

### 12.1 Sidebar

The sidebar is filled with primary, full height. It carries no data, so a strong colour costs nothing in readability (section 36.1).

- 260px wide when open. 64px icon rail when collapsed.
- The top bar (section 12.2) spans the content area beside it and stays neutral, so the brand runs uninterrupted down the full height of the window.
- Navigation items in on-brand, at body weight.
- Items are grouped under small section labels in meta style, in on-brand-muted.
- Maximum seven items at the top level. Beyond that people stop scanning and start hunting.
- **An item belongs to a permission.** Each item may carry the permission key, or several meaning "any of", that opens its area (section 26.3). An item the user cannot use is not rendered (section 26 rule 1), and a group whose items are all hidden loses its label too. The seven-item limit counts the full configured list, not what one user sees: the person who can see everything must still see seven or fewer.
- The sidebar is drawn from the permissions the server sent with the page (section 26.4), so it is right on first paint and never shows an item and then removes it.
- Hover on an inactive item: on-brand-hover. Pressed: on-brand-pressed.
- When collapsed, each icon shows a tooltip with its label on hover.
- The user's open or collapsed choice is saved and restored on the next visit.
- **The active item inverts:** surface fill, primary-text text, body strong weight, 8px radius. These three signals (fill, text colour, weight) always move together. Do not use a primary-subtle tint or an accent bar instead; both become invisible on a brand ground.
- The sidebar never changes when the user drills into a record. The top-level section stays highlighted, and the breadcrumb inside the page shows the depth.

### 12.2 Top bar

56px tall (--spacing-topbar), spanning the content area. Contains only:

- Sidebar toggle, at the far left
- Global search
- Notification bell, with an unread dot in primary
- User menu

Nothing else. Page actions belong in the page header. Anything added to the top bar appears on every screen whether relevant or not.

### 12.3 Content area

- 24px padding on all sides.
- Maximum width 1600px, centred. Wider than this, text lines become too long to read and tables look stranded.
- The page header, with the page title and the one primary action, belongs to the page, not to the shell.


## 13. Empty states

There are three, not one. Using the wrong one makes the software look unintelligent.

| Situation | Message | Action |
|---|---|---|
| Nothing yet | What would normally be here | Secondary: create. The page header's Add stays the one primary |
| Nothing found | Filters matched no records | Clear filters |
| Something failed | What went wrong | Retry |

- Each empty state has three parts: a short heading, one line explaining how to change the situation, and one action button. The one exception, on both layouts: a list of what waits on the person, such as My work or an approval list, with nothing waiting has no action, because there is nothing to create (section 41.15 rule 9).
- Never show a blank area. Never show only the words "No data".
- Never offer "Add your first client" to someone whose filter simply matched nothing.

## 14. Loading states

1. Use skeletons: grey placeholder blocks in the shape of the content that is coming. Never a spinning wheel. The layout arrives first and the page does not jump when data lands.
2. A button that triggers a save shows a loading state on itself and is disabled while working, so nobody clicks Save three times and creates three records.
3. Loading and failed are separate branches. A condition such as rows === null is true both before the first response and after a failed one, so treating it as "loading" shows a skeleton for ever when the request has failed. The three cases of section 13 need three branches.
4. Give every request a deadline at the point it is made. The browser's fetch has no timeout, and most database drivers have none either. A request that stalls never settles, so no error state or Retry button downstream ever runs.

## 15. Destructive actions

1. Any irreversible action opens a confirmation dialog. Never delete on a single click. A reversible action uses Undo instead of a confirmation (section 38.1).
2. The dialog names what is being deleted and states what else will be affected: "This will also remove 4 invoices and 3 open tasks." A confirmation that does not state the consequences is only a speed bump.
3. The confirm button uses the danger style and states the actual verb: "Delete client". Never "OK" or "Yes".
4. Cancel is the safer option and sits on the left.
5. For genuinely dangerous deletions, the user types the record name before the confirm button becomes active.

### 15.1 A destructive action that cannot succeed

Before offering a destructive action, check whether it can succeed for this record. Permission is not the only blocker; the record's own relationships can make deletion impossible.

- Where it cannot succeed, disable the control and give the reason in a tooltip, using permission-tooltip.tsx (section 26).
- If a dialog is already open, it becomes an explanation, not a confirmation. It states why deletion is impossible and offers the alternative, usually deactivation (section 15.2). The primary button is that alternative, not a disabled Delete.
- State the fact neutrally. Do not use the danger colour or an error icon: nothing has failed, and trying again will not change the answer.
- Follow section 7.2 rule 2: cause, then next action, with the action available in the same dialog. Example: "This category is in use on 42 records and cannot be deleted. Deactivate it instead to keep those records and remove it from new entry", with the Deactivate button in that dialog.

### 15.2 Referenced master data is deactivated, not deleted

- Once any record points at a master record, it is deactivated, not deleted.
- Deactivation keeps history intact: existing records still read correctly and existing totals still add up. The deactivated record stops appearing in pickers and nothing new can be booked against it.
- Deleting it instead either removes the records that point to it, silently changing figures people have already seen, or leaves them pointing at nothing, which stays hidden until a report is run. Both are unacceptable.
- On a master list, lead with Deactivate. Delete is only for a record nothing points at yet.
- An unreferenced master record may be deleted outright, under the confirmation rules above.

## 16. Dropdowns and select menus

### 16.1 Trigger

- Height exactly 36px, matching input fields. Chevron on the right.
- The chevron points down when closed and up when open.
- Empty state: grey placeholder text, normal border.
- Disabled state: faded border and faded fill, same as buttons.

### 16.2 Menu

- Width exactly matches the trigger width. Never wider, never narrower. The one exception is an inline text control (section 6.7).
- 12px radius, 1px border, --shadow-menu (section 5.4).
- Options are 36px tall with 12px horizontal padding.
- Maximum menu height is exactly seven rows (--menu-max-height), then it scrolls internally with the custom scrollbar (section 10.1).
- Selected and hovered must look different. Selected is primary-subtle with a tick on the right. Hovered is neutral grey.
- The menu never extends past the edge of the screen. It flips upward when there is no room below.

### 16.3 Long lists

- 6 options or fewer: select.tsx.
- 7 options or more: searchable-select.tsx. Its search box sits fixed above the options and does not scroll with them.
- Several values from one list: multi-select.tsx. It is the searchable-select trigger and menu, except that choosing a row ticks it and leaves the menu open.

### 16.4 Keyboard

A dropdown is fully operable by keyboard: arrow keys move between options, Enter selects, Escape closes, and typing a letter jumps to options beginning with it. Focus returns to the trigger when the menu closes. Data entry staff work far faster on the keyboard than with the mouse.

## 17. Field widths

A field is as wide as the data it holds. Never full width by default. The eye uses field width as a clue about what belongs in the box.

Forms use a 12-column grid.

| Span | Used for |
|---|---|
| 3 | PIN code, amount, quantity, year, percentage |
| 4 | Phone number, date, short dropdown, reference number |
| 6 | Person name, company name, email address, city |
| 12 | Street address, description, notes, anything free-form |

Rules:

1. Minimum field width 160px (--spacing-field-min). The one exception is an amount cell in a data entry grid (section 31), which has its own minimum of 120px. This exception does not extend to other tables with editable fields.
2. A single-line field never exceeds 480px.
3. Number fields align their content right. Text fields align left.
4. Fields that belong together sit on the same row.

### 17.1 Table column widths

- Fixed widths go to predictable columns: dates, periods, reference numbers, counts, status badges and row actions all have a known longest value.
- Free text (names, descriptions, notes, addresses) takes the remaining width and truncates. These are the only columns where truncation is intended.
- Never do it the other way round. Fixed text columns leave the predictable columns too narrow for a date like "22 Sep 2026" or a header like "Amount".
- Widths come only from these tokens. Never use an invented pixel width in a screen file.

| Token | Value | For |
|---|---|---|
| col-tick | 48px | The section 22 tick box column |
| col-count | 96px | Units, quantity, percentage |
| col-date | 128px | A DD Mon YYYY date |
| col-amount | 136px | An amount, right-aligned |
| col-ref | 144px | Reference and document numbers |
| col-status | 152px | A status badge |
| col-actions | 80px | One icon button on a row |
| col-datetime | 192px | A DD Mon YYYY, h:mm A date and time |
| col-scope | 168px | A permission grid cell: a tick and its scope (section 40.4). Re-measured per product |

- Each value is measured: the longest realistic value in Geist at 14px, plus 32px of cell padding, rounded up to the nearest 8. globals.css records each measurement beside its token. Re-measure if the type scale, currency format, status labels or the product's language change.
- A column is never narrower than its own header. If the label does not fit, shorten the label. A header showing an ellipsis means this rule was broken.

## 18. Date and number formats

One format across the whole software.

| Type | Format | Example |
|---|---|---|
| Date | DD Mon YYYY | 12 Aug 2026 |
| Date and time | DD Mon YYYY, h:mm A | 12 Aug 2026, 3:45 PM |
| Number | Indian grouping | 12,45,680 |
| Amount | Two decimals always | 4,200.00 |
| Currency | Symbol before, no gap | ₹4,200.00 |
| Negative amount | Minus sign (−, not a hyphen) before the symbol | −₹4,200.00 |

Rules:

- Never display a date in numeric-only form. 12/08/2026 means two different dates depending on who reads it.
- "2 hours ago" style is allowed in activity feeds and notifications only. Everywhere else uses the full date.
- All numbers, amounts and dates are right-aligned in tables.
- Date fields accept typed entry as well as the calendar picker.

### 18.1 Short amounts on dashboards

Dashboard tiles and chart labels show large amounts in short Indian form, so they can be read at a glance.

| Amount | Shown as |
|---|---|
| Below 1 lakh | In whole rupees: ₹98,500 |
| 1 lakh to below 1 crore | Two decimals and L: ₹12.46 L |
| 1 crore and above | Two decimals and Cr: ₹12.46 Cr |

Rules:

1. Round to two decimals first, then choose the unit. ₹99,99,999 rounds to 100.00 L, so it is shown as ₹1.00 Cr.
2. A space sits between the number and L or Cr. A negative amount starts with a minus sign: −₹12.46 L.
3. Large counts on tiles follow the same table without the ₹: 12.46 L.
4. This applies to dashboard tiles and chart labels only. Tables, forms, detail pages and reports show the full amount, as in section 18. The full figure is always one click away, because every tile links to its list page (section 11.4).

## 19. Tooltips

- On phone, section 41.8 rules 16 to 18 apply instead.
- Appear after a 400ms delay on hover, and immediately on keyboard focus.
- text-primary background, surface text, 13px, maximum width 240px, 8px radius, --shadow-menu (section 5.4).
- Never contain buttons, links or anything clickable.
- Never carry information that is available nowhere else. If the only way to learn something is to hover over it, touch and keyboard users never learn it. There are two exceptions:
  1. the label of an icon-only button (section 6.3);
  2. the reason a control is disabled (section 26). This tooltip must open on tap as well as on hover and keyboard focus, so tablet users can read it.
- Flip position to stay within the screen.

## 20. Date and time pickers

### 20.1 Date picker

- On phone, date and time fields open the phone's own picker (section 41.9 rule 10).
- Displays and accepts DD Mon YYYY (section 18).
- Accepts typed entry as well as calendar selection. Never calendar-only.
- An unparseable or impossible entry shows the inline error of section 11.3 rule 6, and the field keeps what was typed. Never silently discard the entry and restore the previous value.
- The calendar opens in a popover aligned to the left edge of the field.
- Week starts on Monday.
- Today is outlined. The selected date is filled with primary. Unavailable dates are faded and not clickable.
- A date range picker shows two months side by side and states the selected range as text below the calendar.
- Field width: 4 columns (section 17).

### 20.2 Time picker

- 12-hour format with AM and PM, matching the date and time format.
- Separate hour and minute controls, both typeable and selectable.
- Minutes step in 15-minute intervals by default.
- Never show seconds unless the product genuinely requires them.
- Field width: 3 columns (section 17).
- Use time-picker.tsx. The component library has no ready-made time picker; this kit's own is the only one.

## 21. Chart colours

In FRONTEND_RULES_VIEWS.md. Read that file before working on this.

## 22. Bulk selection and actions

- Bulk selection is computer-only, except approving and rejecting several at once on phone (section 41.6).
- A tick box is the first column of any list where more than one record can sensibly be acted on at once.
- When one or more rows are selected, the action bar replaces sort and the view switcher in place. Search and filters stay visible, so the user can keep building the selection (section 22.1). Nothing is pushed down.
- The action bar states the count against the total: "14 of 100 selected".
- Maximum four bulk actions visible. More go in a three-dot menu.

### 22.1 Persistent selection

Selection persists across filter and search changes. It is a running set the user builds up: search "aryan", take 5; search "rishabh", take 4; act on all 9 together.

- Selected rows stay in their normal place within the current filter's results.
- Rows already in the selection carry a faint primary-subtle row tint when they appear in a filtered result.
- A "Show selected only" toggle in the action bar filters the list down to the selection, so the user can review before acting.
- "Select all matching" is scoped to the current filter and adds to the running set. It never replaces it.
- "Clear selection" is always visible in the action bar.
- Selection clears when the user leaves the page. It persists within the screen, not across the session.

### 22.2 Safety

- Destructive bulk actions follow section 15 and state the count: "Delete 9 clients?", with a way to review the list.
- After a bulk change, the success toast carries an Undo link (section 38.1).

## 23. Icons

- Lucide only. Never mix icon sets. Never use emoji as icons.
- Three sizes: 16px in buttons and inputs, 18px in navigation and toolbars, 22px in empty states. The one exception is the 12px chevron in an inline text control (section 6.7). Nothing else.
- Icons inherit the colour of the text beside them. The only exception is a status icon, which takes its status colour.
- An icon never appears without a visible label or a tooltip.
- Icons sit 4px from their label, in buttons, inputs and everywhere else, except in menu, select and command items (8px) and the sidebar's navigation items (12px).
- Never use an icon whose meaning is not obvious. Three dots, arrows and abstract shapes need a label.

### 23.1 Icon map: one meaning, one icon, everywhere

| Meaning | Icon | Meaning | Icon |
|---|---|---|---|
| Edit | pencil | Close | x |
| Delete | trash | More | ellipsis |
| Add | plus | Duplicate | copy |
| Search | search | Confirm | check |
| Filter | funnel | Date | calendar |
| Sort | arrow-up-down | Download | download |
| Show | eye | Hide | eye-off |
| Opens another website | external-link | Partly ticked | minus |
| Added, in a before and after (section 40.10) | plus | Removed, in a before and after | minus |
| Back, phone only (section 41.4) | chevron-left | Opens another screen, on a row (phone rows, section 41.6 rule 5; More) | chevron-right |
| Share (the computer-only page's Share link, section 41.11) | share | Install the app (section 41.12) | smartphone |

Extend this table rather than inventing icons per screen. eye and eye-off are the only pair for show and hide, wherever something is revealed or concealed.

### 23.2 Shell and navigation icons

| Meaning | Icon | Meaning | Icon |
|---|---|---|---|
| Sidebar toggle | panel-left | Sign out | log-out |
| Notifications | bell | User | user |
| Dashboard | layout-dashboard | List view | list |
| Settings | settings | Card view | layout-grid |
| Rising | trending-up | Falling | trending-down |
| Access (section 40.1) | shield | My work, phone (section 41.15) | inbox |
| Computer-only screen, phone (section 41.11) | monitor | | |

- A product adds one row per top-level navigation section, and one for its own product mark, in the same commit that adds the navigation item.
- The sidebar toggle uses panel-left in every state. The tooltip and screen-reader label state the action: "Collapse sidebar", "Expand sidebar", "Open navigation". The icon does not change.

## 24. Dialog sizes

Three widths only.

| Size | Width | Used for |
|---|---|---|
| Small | 400px | Confirmations |
| Medium | 560px | Short forms |
| Large | 800px | Tabs or a table inside the dialog |

On phone, dialogs become bottom sheets (section 41.8). These widths are maximums. On a screen too narrow for the dialog, it becomes the screen width minus 32px (16px each side), so it never touches or passes the screen edge. At 768px, a large dialog is therefore 736px wide.

Rules:

1. Height grows with content up to 80% of the window height. Beyond that, the body scrolls while the header and footer stay fixed.
2. Every dialog has a title and a close button top right, 36 by 36. The dialog header is a section 36 band, so the close button uses the on-brand variant (section 6.3.2). alert-dialog has no band (section 36.6) and no close button: it closes only through Cancel or its action (rule 3).
3. Dialogs close on Escape and on clicking the backdrop. Confirmations are the exception: they close only via Cancel or the action.
4. Never open a dialog from inside a dialog. If a dialog needs to lead somewhere else, it should be a page.
5. The backdrop behind a dialog, alert dialog or sheet is the --backdrop token, derived from --text-primary. All three use this one token; none defines its own overlay.
6. The dialog component builds the scrolling body itself, not the caller. Everything between the header and footer sits in one box that shrinks and scrolls.
   - It builds this only when there is a header or footer. A command palette brings its own layout and scrolling list; wrapping it would add unwanted padding and a second scroller.
   - alert-dialog has the same height cap, so a long list of consequences never pushes Cancel off the screen.

## 25. Toasts

- On phone, position and width follow section 41.8.
- Position: bottom right.
- Duration: 4 seconds for a simple confirmation, 10 seconds when it carries an Undo link (section 38.1). Error toasts never auto-dismiss; they stay until closed.
- Maximum three stacked. Older ones are replaced beyond that.
- Width 360px fixed. Never full width.
- Every toast has a close button.
- A toast never carries information available nowhere else. If the user misses it, nothing is lost.

## 26. Permissions in the interface

1. Hide controls for entire areas the user has no access to. A user who holds no permission in invoicing does not see Invoices in the sidebar at all.
2. Disable individual actions the user can see but cannot perform, and always attach a tooltip saying why, in the wording of section 26.2: "Only people allowed to delete clients can do this."
3. Never show a control that fails after being clicked.
4. Read-only users see the same screens with fields disabled, not a separate stripped-down screen.
5. **Permissions are not roles.** Code asks whether the user holds a permission (section 26.3), never which role they hold. No screen checks for an administrator, and no code carries an isAdmin flag. The administrator's role is an ordinary role that happens to hold every permission. Roles are created and renamed by each client, so nothing on screen or in code may depend on a role's name.

These are appearance rules only. Hiding a button is not security. The real permission check happens on the server.

The server side, and the contract between the two, is the backend kit's ACCESS_RIGHTS.md. Its vocabulary (permission, role, scope, unit, Pick) is used here unchanged.

**How to attach the reason.** Every disabled control in this system has pointer-events-none, so it never receives a hover and a tooltip attached to it never opens. The reason must be caught by a wrapper around the control that is not disabled, and the wrapper must also be focusable so keyboard users can reach the reason. When the action is permitted, the wrapper renders its children unchanged, with no extra element.

The wrapper must also open the tooltip on tap, because a tablet user can neither hover nor press Tab (section 19).

That wrapper is permission-tooltip.tsx. Do not write a second one, and never put a Tooltip directly on a disabled control. If permission-tooltip.tsx does not yet open on tap, fix it there, once, rather than at any call site.

### 26.1 Not known yet is not "not allowed"

The browser learns what the user may do from the server. Until the answer arrives nothing is known, and "not known" must not look like "not allowed".

1. A permission's answer has three values: true, false and undefined. undefined means not known yet.
2. While the answer is undefined, the control is disabled and shows **no reason**. A reason shown before the answer lands is a guess, and is wrong for everyone who turns out to be allowed.
3. When the answer lands, the control enables, or stays disabled and gains its reason. It does not move or change size; only its state changes.
4. A control is never hidden while the answer is undefined and then shown. That makes the toolbar jump (section 14 rule 1).
5. If the permissions failed to load, that is the failed branch of section 14 rule 3, not loading. Controls stay disabled without a reason, and the shell shows a danger banner (section 7.1): "We could not load what you can do here. Try again." with a "Try again" button.
6. A refresh of permissions already held (section 26.4) never returns answers to undefined. The old answers stand until the new ones arrive.

permission-tooltip.tsx takes allowed as true, false or undefined, and the prop is required: an optional prop lets a caller forget it, and a forgotten prop would read as "not known yet" for ever. Only a definite yes enables:

```tsx
const canDelete = useCan("clients.records.delete")
<PermissionTooltip allowed={canDelete} reason={reasonFor("clients.records.delete")}>
  <Button variant="danger" disabled={canDelete !== true}>Delete client</Button>
</PermissionTooltip>
```

### 26.2 Wording the reason

A reason names who may do it by what they are allowed to do, never by a role. Roles are named by each client and change; a permission's label does not.

| Case | Wording |
|---|---|
| The user lacks the permission | "Only people allowed to delete clients can do this." |
| The same, where asking is the next step | "Only people allowed to approve invoices can do this. Ask an administrator if you need it." |
| A rule about this record, not a permission (sections 15.1, 38.3) | State the fact: "You raised this invoice, so someone else must approve it." |
| A whole page (section 26.6) | Section 11.8's no-access wording, unchanged |

Rules:

1. Never "You do not have permission". It says nothing the disabled control did not already say.
2. Never a role name: not "Only an administrator can…", not "Only accountants can…".
3. "Ask an administrator" means a person who manages access, as in section 11.8. It is not a role check.
4. The words come from the permission's label through reasonFor(key) (section 26.3), so each permission has one wording everywhere. A caller writes its own reason only for a record rule (third row), and the server sends those (section 26.5).
5. Section 37 applies: sentence case, plain, cause first.

### 26.3 Asking: lib/permissions.ts

Every question about permissions goes through one file. No screen reads the permission list itself.

```ts
/** module.section.action, as declared in the backend catalogue. */
type PermissionKey = `${string}.${string}.${string}`

/** May this person do this at all? undefined = not known yet (26.1). */
function useCan(key: PermissionKey): boolean | undefined

/** "Any of", for an area opened by several permissions. */
function useCanAny(keys: PermissionKey[]): boolean | undefined

/** The module's see-amounts permission (26.7). */
function useCanSeeAmounts(module: string): boolean | undefined

/** For the shell and lists that ask many questions at once. */
function usePermissions(): {
  status: "loading" | "ready" | "failed"
  can: (key: PermissionKey) => boolean | undefined
  refresh: () => void
}

/** The section 26.2 sentence for a key, built from its label. */
function reasonFor(key: PermissionKey): string

/** The product's unit (section 0.1 item 8). */
const UNIT: { one: string; many: string; grouped: boolean }

/** Mounted once in the app shell. `initial` comes from the server (26.4). */
function PermissionsProvider(props: { initial: MyAccess | null; children: React.ReactNode }): React.ReactNode
```

Rules:

1. Keys are typed, and the type and each key's label are generated from the backend catalogues, never written by hand. A key that does not exist is a type error, not a control that is silently always disabled.
2. useCan answers "may this person do this at all". It never answers "on this record". That is section 26.5.
3. Never check a role name, and never write an isAdmin flag (section 26 rule 5).

### 26.4 Keeping the answer fresh

1. The server renders the user's permissions into the page with the shell (the backend kit's /me payload). The sidebar and the first screen are therefore right on first paint, with no "not known yet" state.
2. The browser asks again in three cases only: when any request comes back "not allowed" (403); when the tab regains focus, at most once every 10 seconds; and after the user saves any access change (section 40), including roles on the person form. Never on 404 or 409; those are not access changes.
3. A refresh keeps the old answers until the new ones land (section 26.1 rule 6).
4. A request refused with 403 shows an error toast with the reason (section 7.1), and the control that sent it moves to disabled with its reason once the refreshed permissions land. It is never left looking usable (section 26 rule 3).
5. A page the user loses access to while it is open is not torn down mid-task. Its controls disable, and the next navigation shows section 26.6.

### 26.5 Record-level answers come from the server

Whether a person may act on one particular record depends on things the browser does not know: the record's unit, its owner, the reporting line, its status. The browser never works these out.

1. Each record the server sends carries its own answers for the actions shown on it: `can: { edit: true, approve: "You raised this invoice, so someone else must approve it." }`. true means allowed; a string is the reason it is not.
2. A row or record action is enabled only when useCan(key) and the record's own answer are both true.
3. The record's reason is shown as given, through permission-tooltip.tsx.
4. Lists show only records the user may see. A filter, search or export never offers a record the user cannot open, so there is no "you cannot open this" state inside a list.
5. A refusal for a workflow rule (409) is an error toast carrying the server's plain reason, then the record reloads.

### 26.6 Opening a page you cannot use

1. Every page whose area belongs to a permission checks it on the server before rendering anything, through one helper in lib/permissions.server.ts:

```ts
/** Returns the no-access page to render, or null to carry on. */
async function guardPage(key: PermissionKey | PermissionKey[]): Promise<React.ReactNode | null>
```

```tsx
export default async function InvoicesPage() {
  const denied = await guardPage("invoices.records.view")
  if (denied) return denied
  // ...
}
```

2. When the answer is no, the page renders the section 11.8 "No access" page inside the shell. It does not redirect, so the address stays in the bar and the user can send it to whoever manages access.
3. The sidebar and top bar stay (section 11.8 rule 1).
4. The check lives in the page or its layout, once. Next's forbidden() is not used while it is experimental in the version this kit runs; if a product enables it, guardPage calls forbidden() and app/forbidden.tsx renders the same page.
5. **A record outside the user's scope is not found, not forbidden.** The server answers 404 for it, and the screen shows the section 11.8 "Page not found" page. Saying "no access" would confirm that the record exists.

### 26.7 See amounts

Some modules have one see-amounts permission covering sensitive figures: cost, rates, salary. The server removes those figures from everything it sends, including exports and reports.

1. A person who cannot see amounts does not see the amount column at all. Never an empty cell, a dash, "Hidden" or a padlock in its place. An empty amount cell reads as "Not set" or zero (section 31.2), which is false.
2. The same applies to totals, summary tiles, chart series, sorts and filters built from those figures. A report whose only purpose is the amounts is an area, and section 26 rule 1 hides it.
3. Columns are chosen with useCanSeeAmounts(module) once, before the table renders, so columns never appear and vanish.
4. A form field holding an amount follows the same rule: absent, not disabled.

## 27. Search, sort, filter and date ranges

### 27.1 Search

- Search covers every meaningful text field on the record by default: name, title, department, email, phone, tags, reference numbers, status labels, and the names of related people. A search that silently misses a field makes the user believe the record does not exist.
- Fields excluded from search are declared with a reason. Long free-text notes are the usual exclusion.
- When a match is in a field other than the main title, the result row shows where it matched, for example "Rishabh Mehta — Delivery", with the matched text in body strong weight (section 3). Matches are never shown with a background colour, because every tint in this system already means something (selected, status or brand).
- The placeholder names the record type, not the field list: "Search clients". A tooltip on the field lists all searchable fields.
- Search runs 300ms after the user stops typing, not on every keystroke.
- A clear button appears inside the field once there is text.
- The result count shows beside the field: "12 results".
- Search combines with filters. It never replaces them.
- When search returns nothing, the empty state states what was searched: "No clients match 'finance'", with an option to clear.

### 27.2 Sort

- Tables sort by clicking the column header. A chevron shows direction, and only the active column shows one.
- Card view uses a Sort dropdown instead, since it has no headers.
- Every list declares its default sort, usually newest first.
- Not every column is sortable. Declare which are.
- Sort survives page changes.

### 27.3 Filter

- The Filter button opens a panel. Filters are never scattered across the toolbar.
- Active filters appear as removable chips below the toolbar, so the user can always see why the list is short and remove any one condition in one click.
- A count sits on the Filter button when filters are active, as described in section 6.8.
- "Clear all" is always available.
- Filters, search and sort persist when the user opens a record and comes back to the list.

### 27.4 Date ranges

The same preset list on every screen:

Today · Yesterday · Last 7 days · Last 30 days · This month · Last month · Last 3 months · This financial year · Custom range

- The active preset is highlighted with primary-subtle and a primary border.
- Custom range opens the two-month calendar (section 20.1).
- The chosen range always displays as readable text: "1 Aug 2026 to 29 Aug 2026". Never only as "Custom".
- Financial year means April to March.

## 28. Dark mode

Structured for, not built. Do not build a dark theme until explicitly asked. Build every colour so a dark theme can be added later without touching any screen.

1. Every colour token is named by its job (surface, text-primary, border, primary), never by its value. No token is called "green" or "grey".
2. Light values sit in one block in globals.css that a dark block can later sit beside. Nothing outside that file knows which theme is active.
3. No screen, component or class contains a colour decision that would need changing when the theme flips.
4. No dark: utility appears in any component or screen. globals.css declares @custom-variant dark, so dark: classes compile without warning, but they are still colour decisions outside globals.css.

**For whoever builds it later.** A dark brand nearly disappears against a dark background. In that case, the dark theme uses a lighter primary with dark text on it; the light theme's primary is never reused unchanged. (For the current product, #174443 would become about #4A9A94.) A light brand has the opposite problem.

Reason it is not built now: once a dark theme exists, every screen must be checked twice, for ever.

## 29. File uploads and attachments

There is no upload control anywhere by default. A screen gets file upload only when explicitly asked for, and the request states what the files are for.

When a screen has uploads:

- The upload area is a bordered drop zone with a browse button inside it. Both dragging and clicking work.
- Accepted file types and the size limit are stated before the user tries: "PDF, JPG or PNG. Up to 10 MB."
- Each uploaded file appears as a row with its name, size, a remove button and a download link.
- Long file names truncate (section 8).
- Upload progress shows on the file row, not as a page-wide overlay.
- A failed upload stays in the list, marked in the danger colour with a Retry action. It never vanishes silently.
- Images show a small preview. Other file types show a file-type icon.
- Removing a saved file follows section 15. Unsaved files may be removed without confirmation.

## 30. Still to be decided

Nothing outstanding. When a new pattern is needed, agree it and add it to this file before building anything against it.

## 31. Data entry grid

In FRONTEND_RULES_VIEWS.md. Read that file before working on this.

## 32. Password fields

In FRONTEND_RULES_ACCESS.md. Read that file before working on this.

## 33. Section tabs

Sub-navigation is deliberately rare. Agree each use before building it.

### 33.1 What it is, and what it is not

- Section tabs switch between sibling views of one section, such as three reports over the same data.
- They are not steps, not a wizard, not filters, and not a place to hide a screen that deserves its own sidebar entry.
- They differ from tabs on a detail page (section 11.2 zone 4). Detail page tabs are about one record; section tabs are about one section of the product.
- Build them with section-tabs.tsx, which wires the existing tabs component to the URL. There is no second tab component. section-tabs.tsx throws past the limit in section 33.5.

### 33.2 Placement

- Between the page header and the toolbar. Nowhere else.
- The toolbar comes after the tabs, because search, filters and sort belong to the active tab, not to the whole section.
- It does not scroll. Like the header, toolbar and pagination bar, it is fixed; only the data area scrolls.

### 33.3 Appearance

Inherited from the tabs component:

- Tab height 36px (section 6.2).
- 24px between tabs (space-6), on a 1px border-light line running the full content width.
- The active tab has three signals together: primary-text text, weight 500, and a 2px primary accent along its bottom edge (section 5.3).
- Resting tabs are text-secondary and turn text-primary on hover.
- Keyboard focus shows the primary-ring outline. Arrow keys move between tabs.
- Sibling tabs look and behave identically. If one carries a count (section 6.8), they all do.

### 33.4 State

- The active tab is stored in the URL as a query parameter, so a view can be linked to and the browser's back button returns to it.
- Switching tabs replaces the history entry rather than adding one.
- Each tab has its own toolbar state. Search, filters and sort do not carry across tabs.

### 33.5 The limit

- Maximum four section tabs. More than that is a navigation problem, not a case for a fifth tab.
- One section tab bar per screen. It never nests inside another.

## 34. Report tables

In FRONTEND_RULES_VIEWS.md. Read that file before working on this.

## 35. Board view

In FRONTEND_RULES_VIEWS.md. Read that file before working on this.

## 36. Brand headers

A header band is the chrome that labels the content beneath it. This section fills it with the brand.

### 36.1 Why

Without bands, the brand appears only on the primary button, the active tab and the selected row tint, and the product looks unfinished. A header band is the largest surface on a screen that carries no data, so a strong colour there costs nothing in readability. A solid band also makes a sticky table header clearly read as sticky.

### 36.2 What qualifies

A header qualifies only if it passes both tests:

1. It labels the content beneath it.
2. It spans the full width of its container and reads as a band, not a line of text.

| Qualifies | Slot |
|---|---|
| Table column header | table-header |
| Card header (panel variant) | card-header |
| Dialog header | dialog-header |
| Sheet header | sheet-header |
| Popover header | popover-header |
| Board column header | section 35.4 |

Inline labels never qualify: the form Label, SelectLabel, DropdownMenuLabel, banner-title. They are text inside a surface, not chrome above one.

A band is always solid primary with on-brand text. Never use primary-subtle for a band. primary-subtle already means "selected" (in tables, selects, menus, the calendar and the board's drop target), and a selected row directly under a header of the same tint would give one style two meanings (section 16.2).

### 36.3 The band is one row

- The band holds the title and the controls that act on its region. Description text sits below the band, on the surface.
- Every band is a single row, everywhere.
- A band's minimum height is --spacing-band: a control's height plus the space above and below it. It is not the control height alone, because a 36px icon button would then hang off the band.

### 36.4 Nesting: the outermost band wins

A header inside another banded region (for example a table inside a card) takes the accent form:

- fill stays surface;
- the label text is primary-text;
- a 2px primary bottom line (section 5.3).

A third level of nesting stays in the accent form. There is no third treatment.

The component resolves this, not the caller. In header-band.tsx, each banded container wraps its contents in BandScope, which raises the band level, and a header reads the level with useBandLevel to switch to the accent form. No call site passes a prop.

### 36.5 Page chrome stays neutral

Section 11.1's zones 1, 2 and 4 (page header, toolbar, pagination bar) and section 11.2's record header never take a band. The page's one primary button is filled with primary and would disappear on a primary ground.

### 36.6 Excluded: surfaces whose colour already means something

alert-dialog and banner keep their plain headers. Their colour carries status meaning (section 2.4), and a brand band there would compete with the warning. alert-dialog.tsx carries a comment saying its plain header is deliberate; do not "fix" it.

### 36.7 Controls inside a band

Section 6.3.2 applies: use the on-brand variant of button.

### 36.8 The tokens

| Token | Value | Used for |
|---|---|---|
| --on-brand | var(--primary-foreground) | Text and icons on a band |
| --on-brand-muted | 80% primary-foreground and 20% primary | Section labels, counts, anything the user can afford to miss |
| --on-brand-hover | primary-foreground at 12% over the ground | Hover on a control in a band |
| --on-brand-pressed | primary-foreground at 20% over the ground | Pressed |

- These are derived, unlike the brand shades in section 2.2, because there is no direction to get wrong: each mixes primary-foreground toward primary, which works for both dark and light brands. A product that sets its eight brand tokens gets these for free.
- **The one check.** --on-brand-muted must measure at least 4.5 to 1 against primary. Check it only where primary-foreground measures below about 7 to 1 against primary (section 0.1). If it fails, raise the share of primary-foreground until it passes. Never lower the requirement.
- Never use text-primary, text-secondary or text-muted on a band (section 2.3).

### 36.9 What this does not change

- The brand swap requirement (section 2.1). Every band value resolves from --primary and --primary-foreground, and check 9 of plan-template.md covers it unchanged.
- Status badges keep their colours wherever they sit, including on a band.
- The report total row stays neutral (section 34.1).
- The type hierarchy (section 3). A band's label keeps its size; only its colour changes, because the ground changed.

### 36.10 A card that holds a section, and a card that is a record

card.tsx has two variants, and only the first takes a band.

| Variant | What it is | Header |
|---|---|---|
| panel (default) | Holds a section of a screen: "Outstanding invoices", "Revenue by region" | Brand band |
| record | Is one record, drawn as a card: card view (section 11.6), a board card | No band |

- A panel's header labels what the panel holds. A record card's title is the record's identifier, part of the content, so it is not a label and takes no band.
- A record card's title is text-primary on surface, at card heading size and weight, in a row the same height a band would be, so record cards line up with panels beside them.
- An icon button on a record card takes the ordinary section 6.3 treatment, not on-brand.
- panel is the default on purpose. Forgetting to mark a record card gives a grid of brand bars, which is obvious and gets fixed. The opposite mistake would be quiet and survive review.

## 37. Writing on screen

Every word on screen follows these rules, so all products read as if one person wrote them.

### 37.1 Capital letters

- Sentence case everywhere on screen: page titles, headings, buttons, tabs, menu items, field labels, column headers, tooltips, toasts and empty states. Only the first word and proper names are capitalised.
- Proper names are people, companies, products and places. They keep their own spelling: "V2E", "Sadbhavna Dham".
- Examples: "Add new client", "Outstanding invoices", "Sign in to your workspace".

### 37.2 Buttons and actions

- A button label starts with a verb and names the thing it acts on: "Save client", "Add invoice", "Delete client" (section 15 rule 3).
- One action always uses the same word, on every screen:

| Action | Word |
|---|---|
| Make a new record | Add |
| Change a record | Edit |
| Destroy a record | Delete |
| Take a record out of a list, where it still exists elsewhere | Remove |
| Keep changes | Save |
| Leave without keeping changes | Cancel |
| Go away from a changed form, in the unsaved-changes warning (section 11.3 rule 10) | Leave |
| Shut a dialog, sheet or panel | Close |
| Get a file | Download |
| Open a record | Open |

### 37.3 Labels and headings

- Field labels and column headers are short nouns: "Phone number", "Due date", "Amount".
- A heading names what is below it: "Recent activity", "Payment details".
- Write words in full. Use a short form only when users say it that way every day, such as GST, PAN or PIN code.

### 37.4 Tone

- Plain, polite and direct, like a helpful colleague. Speak to the user as "you".
- Short sentences, one idea each.
- Messages state the cause, then the next action (section 7.2 rule 2).
- A confirmation says what happened, in the past tense: "Client saved", "3 invoices deleted".
- An empty state says what would be here and how to add it (section 13).

### 37.5 Spelling, numbers and dates

- Spelling follows the product's region. For Indian clients, use Indian English: colour, organisation, cancelled.
- Write counts as digits, with the right singular or plural: "1 task", "2 tasks".
- Dates, amounts and numbers in text follow section 18.

### 37.6 One language per product

1. Each product runs in one language, chosen at setup (section 0.1 item 10): English, Gujarati, Hindi or another. Users get no language switch.
2. Every word on screen comes from one strings file per product, never typed into a component: labels, buttons, messages, toasts, empty states, validation and month names. The language is then set in one place. Text built on the server (permission reasons, refusal messages, notifications, history summaries, My work lines) comes from the backend in the same language, from its own strings catalogue.
3. Sections 37.1 to 37.5 apply in the chosen language: sentence case where the script has capitals, plain words, and one word per action, translated once in the strings file and used everywhere.
4. **Fonts.** Geist has Latin letters only. For Gujarati, Hindi or any other script, the product adds a matching font after Geist in the font stack (Noto Sans Gujarati, Noto Sans Devanagari), at the same two weights, 400 and 500.
5. **Digits stay 0 to 9** in every language, in numbers, amounts, dates and reference numbers, because these are read, typed and copied across systems. Month names are in the product's language.
6. Names entered by the client (people, records, status labels in master data) show as entered.
7. Text in other scripts often runs longer and taller. Every screen is checked in the product's own language, not in English: nothing truncates where it should not, buttons still fit, and the marks above and below letters are never clipped. Control heights stay fixed (section 6.2), so each script is checked at those heights; where marks are clipped, the font's line height is adjusted in tokens, never per screen.

## 38. Undo, edit history and locking

Three layers let people fix their own mistakes while keeping every record trustworthy. Undo is for a mistake just made. Edit history makes every later change visible. Locking protects what has been approved.

### 38.1 Undo

- Reversible actions happen at once, with a toast carrying an Undo link, and no confirmation dialog. Reversible actions are: archive, deactivate, change status, remove from a list, and bulk changes (section 22.2).
- Undo lasts 10 seconds, the life of the toast (section 25). After that the change stands, and is corrected by an ordinary edit.
- Only the person who made the change sees Undo, and only in that toast.
- The action is saved immediately. Undo saves a second change that restores exactly the previous values, and both appear in the edit history (section 38.2).
- Approving is reversible for its 10 seconds, so an approver who clicks by mistake can undo it. After that, only Reopen can change it (section 38.3).
- Permanent deletion is not reversible. It keeps its confirmation dialog (section 15).

### 38.2 Edit history

- Every change to a record is recorded: who made it, when, which field, the value before and the value after. This includes creating the record, status changes, undos and reopening.
- The history appears on the record's Activity tab (section 11.2 zone 4), newest first.
- Nobody can edit or delete the history, including administrators.
- History follows the record's permissions. A field a user cannot see is not shown in its history either.
- Text that other people may already have read (comments, remarks, notes, messages) shows "Edited" in meta style beside its time once it has been changed. Anyone who can see the text can open its earlier versions from that label.

### 38.3 Locking

- Each product declares which statuses lock a record, for example Approved, Closed or Paid. This list sits beside the product's status-to-colour map (section 2.4).
- A locked record shows its fields read-only (section 26 rule 4), with a banner (section 7.1) stating why: "This purchase order is approved, so it can no longer be edited." Its Edit button is disabled, with the same reason (section 26).
- The banner carries a "Request change" button. It asks for a reason, which is required, and sends the request to the approver. The record stays locked until the approver acts.
- The approver's "Reopen" returns the record to an editable status. The reopening and its reason are recorded in the history.

## 39. Keyboard

Every product is fully usable from the keyboard. On phone, Enter follows section 41.7 rule 6 instead of section 39.2, and section 39.3 (where focus goes) applies as written. Data entry staff work faster on the keyboard than with a mouse, and these behaviours are the same in every product. On a Mac, Cmd replaces Ctrl.

### 39.1 Moving around

- Tab moves to the next control and Shift+Tab to the previous one, in reading order: left to right, top to bottom. Tab order always follows the order on screen.
- The first Tab on any page reaches a "Skip to content" link, visible only while it has focus. It jumps past the sidebar and top bar to the page's content.
- Arrow keys move inside a group: menus, select lists, tabs, radio groups, the calendar, the notification panel (section 7.4) and the board (section 35.6.1).
- Keyboard focus is always visible (section 6.4).

### 39.2 Enter, Space and Escape

| Key | Where | What it does |
|---|---|---|
| Enter | A single-line field in a form | Saves the form |
| Enter | A comment or message box | Sends it. Shift+Enter makes a new line |
| Enter | A long text field in a form (description, notes) | Makes a new line. Ctrl+Enter saves the form |
| Enter | A search box | Runs the search at once |
| Enter | A menu, select list or focused button | Chooses or presses it |
| Space | A tick box, switch or focused button | Ticks, flips or presses it |
| Escape | Anywhere | Closes the topmost open layer only: a menu before the dialog under it (section 5.5). An alert dialog closes only through Cancel or its action (section 24 rule 3). In a search box with text, Escape clears the text first |

A form with unsaved changes still asks before closing (section 11.3 rule 10).

### 39.3 Where focus goes

- When a dialog or sheet opens, focus moves to its first field, or to its first button if it has no fields.
- When it closes, focus returns to the control that opened it.
- On an Add page, focus starts in the first field.
- When a save fails, focus moves to the first field with an error.
- After a record is deleted from a list, focus moves to the next row.

### 39.4 Text editing

Inside any text field, Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+A, Ctrl+Z and Ctrl+Y do what the browser does: copy, paste, cut, select all, undo typing and redo typing. The software leaves them to the browser.

### 39.5 Shortcuts

| Keys | What it does |
|---|---|
| Ctrl+K | Opens global search (command.tsx) |
| / | Moves focus to the list page's search box |
| Ctrl+S | Saves the current form or the form in the open dialog. On a screen with no form, the browser's own behaviour is left as it is |
| Ctrl+Z, outside a text field | Presses the Undo on the toast currently showing (section 38.1). With no such toast, nothing happens |
| ? | Opens the "Keyboard shortcuts" dialog, listing every shortcut in this table |

- Single-key shortcuts ("/" and "?") work only when focus is outside a text field, so they never interrupt typing.
- A product may add shortcuts of its own. Each one is added to this table, and so to the "Keyboard shortcuts" dialog, in the same commit.

### 39.6 Data entry grid

In a data entry grid (section 31), Tab moves to the next cell to the right and Enter moves to the cell below, as in a spreadsheet. Shift+Tab and Shift+Enter move the other way. Totals update as the user moves (section 31.3).

## 40. Access screens

In FRONTEND_RULES_ACCESS.md. Read that file before working on this.

## 41. Phone

In FRONTEND_RULES_PHONE.md. Read that file before working on this.

