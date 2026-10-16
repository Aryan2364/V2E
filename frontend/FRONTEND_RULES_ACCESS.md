# Design and Build Rules: Sign-in, passwords and access screens

Part of the rules in FRONTEND_RULES.md (see its section 0.3). That file's rules apply here too, and section numbers match across all the files.

Every product reads this file when it builds its sign-in page, because every product has one (section 11.7), and before building any password field (section 32). Read it also before building or changing any screen for managing people, roles or access (section 40); a product without configurable roles never needs that part.

## 11.7 Sign-in page

The first screen anyone sees. One half tells people what the product is, and the other half signs them in.

**Layout**

- At 1024px and above: two equal halves. The brand panel on the left, the form on the right.
- Below 1024px: the brand panel shrinks to a strip across the top holding only the product mark and product name. The form sits centred below it.

**The brand panel (left half)**

- The ground is primary. It may use a diagonal gradient from primary to primary-pressed, and a faint grid pattern drawn in on-brand at 6% opacity (--brand-pattern-opacity). Both come from tokens, so the whole panel follows a brand change.
- It holds exactly three things, and nothing else:
  1. **Top:** the product mark and product name, the name at section heading size (20px) in on-brand.
  2. **Middle:** one headline of eight words or fewer, in the Display size (section 3), weight 500, never bold. Below it, one supporting line of one or two sentences, at 16px, weight 400, in on-brand-muted.
  3. **Bottom:** one footer line at meta size in on-brand-muted: the year and the product name.
- One short phrase in the headline may be highlighted in --on-brand-accent. Only one, and only here.

**--on-brand-accent**

- Keep primary's hue exactly and set saturation to 45%. For a dark brand, set lightness to 72%; for a light brand, set lightness to 28%.
- It must measure at least 4.5 to 1 against primary. If it does not, move the lightness further from primary's until it does.
- It is part of the brand block in globals.css (section 0.1) and is used nowhere else.

**The form (right half)**

- surface background. The form is 400px wide (--spacing-auth-form), centred both ways.
- A page title ("Sign in to your workspace"), then one helper line in text-secondary.
- Two fields, each with its label above and a required asterisk (section 11.3). The fields run the full width of the form. The password field is password-input.tsx (section 32).
- "Forgot your password?" sits right-aligned directly under the password field, as a standing text link (section 6.6).
- One large primary button (40px), the full width of the form. While signing in, it shows its loading state and is disabled (section 14 rule 2).
- Autofilled fields are styled per section 1 rule 5, never Chrome's pale blue.
- A failed sign-in shows a danger banner above the button, never saying which field was wrong: "The email or password is not right. Check both and try again." A field that is simply empty gets the normal inline error on leaving it (section 11.3 rule 6).

**Sign-in methods**

Each product signs in with one or both of two methods, chosen from its requirements (section 0.1 item 10): email and password, or an OTP sent by SMS to a mobile number. The form above is the email and password method. Where a product offers both, its main method shows first, with a standing text link (section 6.6) to the other below the button: "Use email and password instead" or "Use mobile number instead".

Mobile number and OTP:

1. Step one: one field, "Mobile number", with the country code fixed at its start (+91 for Indian products), 10 digits, the phone keypad on phones. One large primary button: "Send OTP".
2. Step two: "Enter the 6-digit OTP sent to +91 98••• ••421", with a "Change number" text link. One OTP field, numbers only, with autocomplete="one-time-code", so the phone offers the OTP from the SMS. It signs in by itself once the last digit is in.
   - **Drawn as one box per digit.** The field is one real input drawn as a row of boxes (otp-field.tsx), never one input per box: separate inputs break the phone's offer of the OTP from the SMS, pasting the code, and how a screen reader announces the field. Typing fills the boxes in turn, Backspace steps back, and a pasted code fills them all. The box the next digit goes into shows the focus ring (section 6.4). Each box is the control height: 36px, and 44px on phone (section 41.9).
   - **The number of digits is a product setting**, 6 by default, set once where the product configures its sign-in page, never per screen. It matches the OTP the backend sends, and every wording follows it ("Enter the 4-digit OTP"). 6 is the default because a shorter code is easier to guess (rule 4 limits the guesses). On Android, the OTP is read with the browser's OTP reader (Web OTP), which needs the SMS to end with the line "@<product domain> #<code>". The backend sends every OTP SMS in that format.
3. "Resend OTP" becomes available after 30 seconds. Until then it shows the countdown: "Resend OTP in 0:24".
4. A wrong OTP shows the inline error "That OTP is not right. Check the SMS and try again." After 5 wrong tries the server blocks the number for 15 minutes, and the message says when they can try again.
5. An expired OTP shows "This OTP has expired. Send a new one.", with Resend OTP available at once.
6. An unregistered number gets the same step two as a registered one. The screen never confirms whether a number has an account.

## 32. Password fields

Every password field uses password-input.tsx, with its visibility toggle. It is the only way a password is entered anywhere: sign-in, setting a password in Settings, and anything added later.

Reason: a hidden password stops people telling a typo from a wrong password. Hiding by default is still right, because someone may be looking at the screen. So it is a toggle.

### 32.1 The toggle

- An icon button inside the field, so section 6.3.1 applies: use the in-field variant, 32 by 32 (section 6.2).
- eye to show, eye-off to hide (section 23.1).
- The label and tooltip state the action, not the state: "Show password" when hidden, "Hide password" when shown. It also carries aria-pressed.
- It sits inside the field, on the right.
- It is type="button", so pressing it never submits the form.

### 32.2 Hidden by default, never remembered

- The field is hidden every time it appears.
- The shown state is local component state. It starts hidden and resets every time the field appears.

### 32.3 What it does not do

- No strength meter, and no rules shown while typing. If password rules are added, breaking one is an inline field error on leaving the field (section 7.1); the rule itself may be stated as fixed helper text (section 32.4).
- No confirm-password field. The visibility toggle makes it unnecessary.

### 32.4 Helper text

- Helper text sits below the field, never as a placeholder (section 1 rule 12). Example: "Leave blank to keep the current password".
- Show such text only where it is true. On a create form there is no current password to keep.
- A field that sets a password may state its rule as fixed helper text: "Use at least 8 characters." It is there before anything is typed and never changes while typing, so section 32.3 allows it.

## 40. Access screens

Who may do what is set on four screens; the one exception is a person's roles, which the person form may also set (section 40.6 rule 9). Every product with roles uses them as written here. The backend kit's ACCESS_RIGHTS.md fixes what each screen must show and do (its section 7.4); this section fixes how it looks and behaves. A product without configurable roles skips this section. The access screens are computer-only (section 41.1).

The words are the backend kit's, used the same way on every screen and in every message:

| Word | Meaning |
|---|---|
| Permission | One action on one section of one module: "Invoices › Records › Approve" |
| Role | A named set of permissions, each carrying a scope. People hold one or more roles, and their access is the sum of them |
| Scope | Which records a permission reaches: Own, Team, Selected units or All |
| Unit | The product's one business-unit dimension (section 0.1 item 8). On screen, always the product's own word |
| Pick | Seeing names only, to choose them in a list on another screen. Never shown as a tick (section 40.5) |

Scope labels, exactly, in this order wherever scopes are listed:

| Scope | Label | Meaning |
|---|---|---|
| Own | Own | Records they created or are named on |
| Team | Team | Their own, plus those of everyone under them in the reporting line, plus the units they or those people lead |
| Selected units | "Selected " and the unit's plural: "Selected branches" | The units ticked on their access page, plus the units they lead |
| All | All | Every record |

There is no "None". An unticked permission is no access.

### 40.1 Where the four screens live

1. One sidebar item, **Access**, with the shield icon, behind the permission that manages access. Everyone else does not see it (section 26 rule 1).
2. Inside it, four section tabs (section 33), in this order: **Roles**, **People**, **What they can do**, **History**. Four is the section 33.5 limit, and nothing else is added here.
3. The role editor (section 40.3) and a person's access page (section 40.7) are pages under their tab, reached by opening a row. Breadcrumbs: "Access › Roles › Office accountant", "Access › People › Rakesh Mehta".
4. Neither is a dialog. Both hold more than a short form, and both can raise a warning that would otherwise need a dialog inside a dialog (section 24 rule 4).
5. Changes take effect on the person's next request. No screen says "may take a few minutes".

### 40.2 Roles list (the Roles tab)

A list page (section 11.1).

1. Columns: Name (TableRowLink, free width, truncates), People (col-count, right-aligned), row actions (col-actions).
2. **People** is the number of active people holding the role now. It is a link that opens the People tab filtered to that role, with the filter showing as a chip (section 27.3). Zero is written "0" and is not a link.
3. Job roles are named after the job ("Office accountant"). Add-on roles, held on top of a job role, start with "+" ("+ Invoice approver"). The "+" is how they are told apart; there is no Type column.
4. Default sort: job roles first, then add-on roles, each alphabetical.
5. Row actions in the three-dot menu: Edit, Duplicate, Delete.
6. A role can be deleted only while nobody holds it. Otherwise Delete is disabled with its reason (section 15.1): "3 people have this role. Remove it from them before deleting it." Deleting follows section 15. The history keeps the role's name (section 40.10).
7. **The system role** (the one that holds every permission) cannot be edited or deleted. Its Edit and Delete are disabled with "This role always holds every permission and cannot be changed." Its row opens the editor read-only (section 40.3 rule 14).
8. Duplicate opens the role editor as a new role, named "Copy of Office accountant", with every tick and scope copied. Nothing is saved until Save.
9. **Add role** is the page's one primary button. It opens the role editor empty.

### 40.3 Role editor: the permission grid

A form page (section 11.3) with a fixed footer (section 11.3 rule 8), because it is long.

```
Access › Roles › Office accountant
Office accountant                                                      [⋯]
14 people have this role
┌─ Details ───────────────────────────────────────────────────────────────┐
│ Name *                     Description                                  │
└─────────────────────────────────────────────────────────────────────────┘
Own: records they created or are named on. Team: ... All: every record.
┌─ Invoices ──────────────────────────────────────────────────────────────┐
│ [▣] Everything in Invoices   [ ] See amounts (cost, rates)              │
│ ┌──────────────────────────┬────────────┬────────────┬────────────┐     │
│ │ Section                  │ View       │ Add        │ Approve    │     │
│ ├──────────────────────────┼────────────┼────────────┼────────────┤     │
│ │ [■] Records              │ [■] All ▾  │ [■] Own ▾  │ [■] Own ▾  │     │
│ │     Also includes: pick clients       │            │            │     │
│ │ [▣] Payments             │ [■] Team ▾ │ [ ]        │            │     │
│ │ [ ] Reports              │ [ ]        │            │            │     │
│ └──────────────────────────┴────────────┴────────────┴────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
═══════════════════════════════════════════════════════════ fixed footer ═
                                                   [Cancel]  [Save role]
```

[■] ticked, [▣] partly ticked, [ ] unticked; a blank cell means that section has no such action. "All ▾" is the scope as an inline choice (section 40.4).

**The page**

1. Breadcrumb, then the record header (section 11.2): the role name as the page title, and "14 people have this role" as the meta line. The three-dot menu holds Duplicate and Delete.
2. A Details card (name and description). Then one line stating the meaning of each scope, once, so the scope menus need no explanations of their own. Then one panel card (section 36.10) per module, in the catalogue's order. Every module in the catalogue appears, including ones added since the role was last edited; their ticks start empty.
3. The page owns the vertical scroll (section 10). Each module's table scrolls sideways inside its own overflow-x-auto container when it is too wide, with the Section column frozen and its 1px right border (sections 31.4, 34.3). The card must not clip it.
4. **One Save for the whole role**, the primary button in the fixed footer, labelled "Save role", with Cancel on its left (section 11.3 rule 7). Never a Save per module card: a role is one record, and saving half of it gives people half a role. This is not a settings page, so section 11.5's Save per card does not apply.
5. Unsaved changes are guarded (section 11.3 rule 10, unsaved-changes.tsx). Ctrl+S saves (section 39.5).
6. The save toast states the effect: "Office accountant saved. 14 people have the new permissions from their next request."

**The module card**

7. The band holds the module name only. Ticks never sit on a band: a primary tick on a primary ground cannot be seen.
8. The first line of the card body holds the module tick, "Everything in Invoices", and the module's see-amounts tick where the module has one (section 26.7), naming what it covers: "See amounts (cost, rates)".
9. The module tick is ticked when every permission in the module is ticked, partly ticked when some are, and unticked when none are. Ticking it ticks every unticked permission at its starting scope (section 40.4 rule 4); permissions already ticked keep their scope. Unticking it clears the whole module, see amounts included.

**The table**

10. Rows are the module's sections; columns are the module's actions, in the catalogue's order, with short names: "View", "Add", "Edit", "Delete", "Approve", "Export" (section 37). A cell for an action its section does not have is empty: no tick, no dash. It is not a disabled tick, because no one can ever tick it, and a disabled control would need a reason.
11. The Section column is the row spine (TableRowHeader, section 34.3): tinted, body strong, frozen. It starts with a row tick that is ticked, partly ticked or unticked across that section's actions, and behaves like the module tick for one row. A ticked row is a value, not a selection, so the row takes no selected tint.
12. Each cell is a tick box, with its scope beside it once ticked (section 40.4).
13. The permission that manages access is never offered on an ordinary role. The module holding it appears only on the system role.
14. **The system role's editor is read-only.** Every permission is ticked at All, every tick is disabled, scopes are plain text, there is no Save, and one neutral banner sits above the first module card: "This role always holds every permission, in every module, at All. It cannot be changed."

**Keyboard**

15. Tab moves through the ticks and scope choices in reading order. Space ticks (section 39.2). Enter or Space on a scope opens its menu. The grid does not use the spreadsheet movement of section 39.6: its cells are controls, not text fields.

Component: permission-grid.tsx (pending, section 4.1). It renders one module. The page owns the whole role, the cross-module Picks and the one Save.

### 40.4 Scope on a tick

1. A ticked cell shows its scope beside the tick as an inline choice (sections 6.7 and 40.3): the scope's label in primary-text, underlined, with the 12px chevron, 8px (space-2) from the tick. An unticked cell shows the tick alone.
2. Scope is chosen per tick, never per row or per module. "View all, edit own" is the most common shape a role takes.
3. The choice offers only the scopes that section can honour (backend kit section 3.4), in the order of the table above. Where a section offers one scope, the scope is plain text beside the tick, not a choice.
4. **A new tick starts at the narrowest scope.** That is Own wherever the section offers it, otherwise the only scope it offers. The administrator widens it on purpose. A tick never starts at All because All is convenient, and ticking again after unticking starts at the narrowest scope again. This is least privilege: a mistake that gives too little is noticed and fixed; one that gives too much is not.
5. Every action column is col-scope wide (section 17.1), so a column never changes width as scopes change and the scope label never truncates. col-scope is measured on "Selected units" and re-measured for the product's own unit word (section 0.1 item 8).
6. A scope's screen-reader label names the permission: "Scope for approve invoices".

### 40.5 Picks

Some permissions need Pick on another section, so the person can choose from that list on a form: adding an invoice needs Pick on clients. The catalogue in code says which.

1. **Pick has no column and no tick.** It is not something an administrator grants on its own.
2. **Picks follow the ticks.** Ticking a permission adds the Picks it needs, at that permission's scope or at the wider scope the catalogue fixes. When no ticked permission needs a Pick any longer, it goes.
3. **They are never added silently.** A row whose ticked permissions bring in Picks shows one line under the section name in its row spine, in label style: "Also includes: pick clients, pick price lists". Label style, not meta: text-muted fails contrast on the primary-subtle spine (section 2.3).
4. A list everyone may pick from (the catalogue's pick-for-everyone) is never mentioned.
5. Every Pick a person holds is listed in full, with what it is for, on What they can do (section 40.9).

### 40.6 People list (the People tab)

A list page (section 11.1).

1. Columns: Name (TableRowLink), Roles (free width, truncates), Selected units (free width, truncates), Status (col-status), row actions (col-actions). Below 1024px Selected units is secondary and hides (section 10 rule 4). The column header uses the product's unit word: "Selected branches".
2. **Roles** lists every role they hold, comma separated, job roles first, then add-on roles, each alphabetical. It truncates (section 8), with the full list in the tooltip and on the person's page, so the tooltip is never the only source. Never a count pill: section 6.8's count is for controls, not cells. A person with no roles reads "No roles".
3. **Selected units** summarises the units ticked on their page. Where units are grouped, by group: "North: all 6 · East: 2". Otherwise as a count: "4 branches".
   - If none of their roles uses the Selected units scope: "Not used by their roles", in text-muted.
   - If a role uses it and no unit is ticked: a warning badge, "None chosen". Their Selected units permissions then reach nothing, which is almost always a mistake.
4. **Status**: Active (success) or Inactive (neutral).
5. Filters (section 27.3): Role, Status, the unit group where there is one, and "Selected units: none chosen". The Role filter is what the Roles list's People link sets.
6. Row actions: Edit access, What they can do (opens that tab for this person), Deactivate or Activate.
7. Deactivating a person is reversible: it happens at once, with an Undo toast (section 38.1): "Rakesh Mehta deactivated. Their access ends on their next request."
8. Units nobody covers are reported in the list banner (section 40.8).
9. Adding a person and editing their own details belong to the product's people screens, not to Access. The person form may also carry a **Roles** field, so the commonest access change is made where the person is added:
   - It is multi-select.tsx, offering every role, job roles first, then add-on roles. On Edit, the roles held start chosen.
   - It is a quicker form of the Roles card on the person's access page (section 40.7), not a second set of rules. It saves in the same request as the rest of the form, through the same access write, so the access history records it (section 40.10) and a refused role saves nothing else either.
   - It is enabled only for someone who can manage access, and otherwise disabled with its reason (section 26).
   - The access page's safeguards still hold. Removing your own access asks first (section 40.7 rule 3), and for the last person who can manage access, the role that gives it is locked (section 40.11). The server marks which roles give that access, so the form can tell.
   - A refusal from the server, such as a role deleted meanwhile, shows on the Roles field as an inline error (section 7.1).
   - Nothing else moves to the form. Selected units, What they can do and history stay on Access. On Edit, one standing text link (section 6.6), "More access settings", opens the person's access page.

   **Add person** appears here only if the product has no other place for it, and then it is the one primary button.

### 40.7 A person's access page

Opened from a People row. A form page with a fixed footer and one Save, like the role editor (section 40.3 rule 4).

**The page**

1. The record header holds the person's name, their Active or Inactive badge, and a meta line: who they report to, and the units they lead. "What they can do" is a secondary button that opens that tab for this person. The three-dot menu holds Deactivate (or Activate) and "View access history" (the History tab filtered to this person).
2. Save is "Save access". The toast: "Rakesh Mehta's access saved. It applies from their next request."
3. Removing your own access to these screens, by removing the role that gives it, is allowed while someone else can still manage access, but asks first in an alert dialog: "Remove your own access to these screens?" "You will no longer be able to manage roles or people. Someone else who can will have to give it back." Buttons: "Keep my access" and "Remove my access".

**Roles card**

4. One row per role held: the role name, the scopes that role uses in text-secondary, and a quiet remove icon button (x, tooltip "Remove role"). Job roles first, then add-on roles.
5. Below the rows, a picker of the roles not yet held (section 16.3) and a secondary **Add role** button beside it. Adding or removing changes the form, not the record, until Save.
6. Roles only add up. Nothing on this page grants or removes a single permission; only roles do.

**Selected units card, and the unit picker**

7. Shown only when at least one held role uses the Selected units scope. Otherwise one line replaces it: "None of their roles uses selected branches." Ticked units are kept, not cleared, in case such a role is added back.
8. The first line says which roles use it, and the count: "Used by Office accountant. 8 of 48 branches selected."
9. **Every unit is shown, unpaginated** (the section 1 rule 7 exception): paging would split a group and hide ticks. The page owns the scroll; the card never scrolls on its own (section 10).
10. **Search appears above 50 units.** At 50 or fewer, the list alone is quicker to scan than a search box. Above 50, a search box sits above the list and filters units by name, as section 27.1 describes. Ticks hidden by the search stay ticked.
11. **Groups, where the product groups its units.** Units sit under their group. Each group row has a tick that is ticked, partly ticked or unticked across its units, with "6 of 6" beside it. Ticking it ticks every unit in the group, and any unit can then be unticked on its own. What is stored is the units, never the group, so a unit added to the group later is not ticked. While a search is active, the group tick acts only on the units shown, and its label says so: "Tick the 2 shown". Groups start expanded and collapse instantly, never with an animated height (section 5.6 rule 1).
12. Units sit as tick boxes in a wrapping grid: 4 columns at 1280, 3 at 1024, 2 at 768 (section 9). Names truncate (section 8).
13. Units the person leads, which they see without being ticked, are listed at the foot of the card as text, with "(set on each unit)". They are not ticks here, because they are changed on the unit.
14. Deactivated units are not listed.
15. If a product's units could grow into the hundreds, this pattern needs agreeing again (section 30) before it is built.

Component: unit-picker.tsx (pending, section 4.1).

### 40.8 Units nobody covers

A new unit is not given to anyone automatically. Until someone covers it, its records are seen only by people with All scope.

1. While any active unit is uncovered, the People tab shows the list banner of section 11.1 zone 1b, in warning, one line (section 7.5): "3 branches have nobody covering them." The branches are named on the page its action opens.
2. Its one action, **Review branches**, opens the product's units list filtered to the uncovered units, where a lead can be named or a person opened to tick it.
3. What "covered" means is decided by the server and sent as a list.

### 40.9 What they can do (the third tab)

A read-only view of one person's real access: every permission they hold, its scope, and which role gave it.

1. The toolbar holds one control: the person, chosen with the picker of section 16.3. The chosen person is in the URL, so the view can be linked to and the People row action opens it directly. With nobody chosen, the area shows section 13's nothing-yet state: "Choose a person to see what they can do."
2. **Edit access** is a secondary button that opens their access page. There is no primary button: this view changes nothing.
3. A summary under the toolbar: name and status badge, their roles in one line, their selected units in the form of section 40.6 rule 3, the units they lead, and the size of their team.
4. One panel card per module **where they hold at least one permission**, in catalogue order. After the last card, one line in text-secondary names the modules where they hold nothing: "No access to: Payroll, Stock." Absence is stated, not left to be inferred.
5. Each card's first line states see amounts, where the module has it: "Sees amounts: yes, from Office accountant" or "Sees amounts: no".
6. The table has the columns Section (the row spine, named once per group of rows), Action, Scope and From. It is not paginated: its rows are the code catalogue, which only a release changes (the section 1 rule 7 exception).
7. **Scope is the combined reach.** Scopes from several roles add up, so they are listed together: "Team, Selected branches". All replaces the rest: never "Own, All".
8. **From** names every role that grants the permission, each with its own scope where they differ: "Office accountant (Own), + Invoice approver (All)". This is how an administrator answers "why can they do this?".
9. **Picks are listed in full**, as rows with the action "Pick" and what they are for: "All, for add invoices".
10. An inactive person's view carries a neutral banner: "Rakesh Mehta is inactive, so none of this applies until they are activated." The table still shows what would apply.
11. Workflow rules (for example, that a creator cannot approve their own record) are not permissions and are not listed. One line under the summary says so: "Some actions also depend on the record itself, such as who raised it."

### 40.10 Access history (the fourth tab)

Every access change across the product, newest first. A record's own history (section 38.2) is unchanged; this is a separate list because access changes belong to no single record.

1. A list page (section 11.1). 25 rows per page. Default sort: newest first, and When is the only sortable column.
2. Columns: When (col-datetime, the section 18 date and time, never "2 hours ago"), Changed by, Affected (a person's name, or "Role: " and the role's name), Change (a one-line summary, free width, truncates).
3. One summary form per kind of change: "Role added: + Invoice approver", "Role removed: …", "3 permissions changed", "Branches: 2 added, 1 removed", "Lead changed", "Reports to changed", "Deactivated", "Activated", "Role created", "Role deleted".
4. Names show as they were at the time of the change. A role renamed or deleted since keeps its old name here.
5. Filters (section 27.3): Changed by, Affected person, Affected role, Kind of change, and the date range presets of section 27.4. Search covers the names of people and roles.
6. Clicking a row opens a sheet (sheet.tsx, from the right) with the full change: who, when and whom, then **Before** and **After** for each changed item, each line marked with the plus or minus icon and the words "Added" or "Removed". No status colours: a removal is not a failure.
7. Nobody can edit, delete or undo an entry. There are no tick boxes and no row actions, and the sheet has no button but Close.
8. A person's page links here filtered to that person (section 40.7 rule 1), with the filter showing as a chip. There is no second history list.

### 40.11 Someone must always be able to manage access

The server refuses to remove or deactivate the last person who can manage access. The screens show that before anyone tries, using section 15.1. The server sends, with each person, whether they are that last person.

1. On the last holder's row and page, Deactivate is disabled with the reason: "Rakesh Mehta is the only person who can manage access. Give that to someone else first."
2. On their page and on the person form (section 40.6 rule 9), removing the role that gives that access is disabled with the same reason.
3. The server checks regardless (section 26). If it refuses anyway, for example because two people acted at once, the refusal is an error toast with the same sentence, and the person's state reloads. On the person form it is the Roles field's inline error instead, so nothing typed is lost.
4. The words name what the person can do, not a role (section 26.2).

### 40.12 Checks before an access screen is done

1. Load every screen as someone who can manage access and as someone who cannot. The second sees no Access item, and gets the no-access page on every Access address.
2. Throttle the network and load a screen with permission-gated buttons: they show disabled without a reason, then settle, without moving (section 26.1).
3. In the role editor: tick a permission that needs a Pick. The "Also includes" line appears under its row. Untick it: the line goes. A new tick starts at the narrowest scope.
4. Tick a group of units, untick one, save, reload: the group reads partly ticked and the count is right.
5. With one person able to manage access, try every way to remove it: row action, person page and person form. Each is disabled with its reason before the server is reached.
6. Section 9 widths: 1280, 1024 and 768. The permission grid scrolls sideways inside its card, the Section column stays frozen, the columns do not change width as scopes change, and the page never scrolls sideways.
7. Where the person form carries Roles: change a person's name and roles in one save, and check the change is in the access history. Then delete one of the chosen roles in another tab and save again: the Roles field shows the refusal, and nothing on the form was saved.
