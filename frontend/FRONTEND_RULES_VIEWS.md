# Design and Build Rules: Charts, data entry grid, report tables and board view

Part of the rules in FRONTEND_RULES.md (see its section 0.3). That file's rules apply here too, and section numbers match across all the files.

Read this file before building or changing a chart (section 21), a data entry grid (section 31), a report table (section 34) or a board view (section 35).

## 21. Chart colours

Charts have their own palette. The colours must stay distinguishable side by side and in a small legend.

Categorical sequence, used in this order:

| Position | Colour | Name |
|---|---|---|
| 1 | var(--primary) | The product's brand (currently bottle green, #174443) |
| 2 | #C2841D | Ochre |
| 3 | #3B5A9A | Indigo |
| 4 | #A34A5E | Rose |
| 5 | #6FA8A4 | Light teal |
| 6 | #7A7268 | Warm grey |

- Position 1 belongs to the product. Positions 2 to 6 belong to the system. A new product runs the section 21.1 check before its first chart.
- Positions 1 and 2 are maximally different, because most charts have only two or three series.
- For a single measure across a range (heat maps, single-series columns), use the five-step ramp --chart-ramp-1 to --chart-ramp-5 instead. It runs from primary-subtle to primary-text, mixed in globals.css at 0%, 25%, 50%, 75% and 100%, so it follows the brand and always ends dark.

Rules:

1. Maximum six series in one chart. Group the smallest into "Other".
2. Never use the status colours in a chart unless the chart is about status. A red bar meaning "third quarter" will be read as a problem.
3. Label lines and bars directly where space allows, rather than relying on a legend.
4. Bar chart axes always start at zero. Line charts may start elsewhere but must say so.

**Building charts**

- Charts use recharts, through bar-chart.tsx. CategoryBarChart has every rule above built in: the palette in order, a hard limit of six series (it throws on a seventh), a zero baseline no prop can move, and direct labels. The caller names its series and cannot name a colour.
- A chart of a different shape is a new component built the same way. Do not bypass this one, and do not install a second charting library.
- Style a chart's text with CSS rules, not the library's fill and fontSize props. Those props become SVG attributes, which cannot hold a var(), so no token can reach them.
- A chart that measures its container measures it with getBoundingClientRect() on mount as well as observing it with a ResizeObserver. A ResizeObserver can be delayed in a background browser tab, leaving the chart at zero width.

### 21.1 Keeping the brand apart from positions 2 to 6

Positions 2 to 6 never change. But a brand colour that lands close to one of them makes two series look like one. This check prevents that.

**The measure.** Colour difference is CIEDE2000 (the sRGB hex converted to CIELAB at D65, then the CIE 2000 formula with kL = kC = kH = 1).

**The threshold is 24.28.** It is the closest distance between any two of positions 2 to 6 (ochre against warm grey). The palette already accepts that separation, so nothing closer is acceptable. Do not re-derive this number; use it as stated.

| | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|
| 2 Ochre | — | 52.50 | 39.30 | 36.39 | 24.28 |
| 3 Indigo | 52.50 | — | 31.79 | 36.06 | 28.73 |
| 4 Rose | 39.30 | 31.79 | — | 47.05 | 24.66 |
| 5 Light teal | 36.39 | 36.06 | 47.05 | — | 26.05 |
| 6 Warm grey | 24.28 | 28.73 | 24.66 | 26.05 | — |

**The check.** Measure the brand against positions 2 to 6. A position fails when its distance to the brand is below 24.28.

```
for position in 2..6:
    if ciede2000(brand, chart[position]) < 24.28:
        position fails
```

- Usually nothing fails and nothing is done. The current brand's nearest later position is 3, at 25.73, which passes.

**The substitution.**

1. Replace only the failing position, in the product's own globals.css. Every passing position keeps its system value.
2. Check the substitute against the whole palette: it must clear 24.28 against the brand and against all four remaining positions.
3. If two positions fail, substitute both, and check each substitute against the other as well.
4. If nothing clears the full palette, use fewer series and group the smallest into "Other". Never ship two series that look like one.

**Where it is recorded.** In the product's own brand block in globals.css (section 0.1), and nowhere else. Never write a substitution back into this kit. This kit records no substitutions, and that is correct.


## 31. Data entry grid

A grid is a table whose cells are editable and form a matrix: two axes that both mean something, every cell holding the same unit, and totals along each axis.

Worked example: a per-unit budget sheet with 19 cost categories down the side and 5 budget periods across the top, 95 cells, every one an amount in the same currency.

A list of records with editable fields is not a grid. A form is not a grid. One axis is not a matrix. The exceptions in this section apply only to true grids.

The permission grid (section 40.3) is a matrix but not a grid in this sense: its cells hold a tick and a scope, not one unit, and it has no totals. It has its own rules. It shares only this section's frozen first column and sideways scroll.

### 31.1 The cell

- An amount cell is sized to its content, with a minimum of 120px (--spacing-grid-cell), not the 160px of section 17.
- 120px is measured: in Geist at 14px with tabular figures, a twelve-character amount is 94px, plus 24px input padding and the border. Re-measure for a different type scale or currency format.
- An amount is never truncated. Three dots read as "more text"; a number missing digits is silently a different number.
- Right-aligned, tabular figures (sections 17 and 18).
- Height 36px (section 6.2).
- Standard input border, focus ring and disabled treatment. It is an input in a table, not a new control.

### 31.2 Empty is not zero

A cell nobody filled in and a cell deliberately set to zero are different facts and look different.

- Empty: placeholder "Not set" in text-muted. Never 0.
- Zero: 0.00 in text-primary.

The stored data follows the display exactly:

| The user does this | The store does this |
|---|---|
| Types 0 and saves | Writes a row with the amount 0 |
| Clears a cell that held 0 and saves | Deletes the row |
| Leaves a cell empty | Writes nothing |

Required test: type 0, save, clear, save. The row is gone and the cell reads "Not set" again.

### 31.3 Totals

- A row total sits in the last column; a column total in a footer row. Both are body strong and never editable. The grand total sits where they meet.
- A total over only empty cells is not zero. It shows the same words the product's read-only screens use for an absent figure, not 0.00.
- A total that mixes an explicit zero with empty cells is a number: the zero is data.
- Totals recalculate as the user types. They are the only thing on screen that moves while typing. Validation still waits for the field to be left (section 11.3 rule 6).

### 31.4 Width and scroll

- The grid sits in a container that scrolls sideways only when there is not enough room, with the first column frozen throughout. Scrolling depends on available space, not on a breakpoint, because the same screen width fits or does not depending on whether the sidebar is open.
- Where there is spare room, the table (w-full) stretches rather than leaving a gap.
- The head column is --spacing-grid-head (240px).
- Measure the fit in the running browser after any change to the head column, cell width or page padding. Never calculate it on paper.
- The frozen column carries a 1px right border, so cells sliding under it read as a boundary, not clipping.
- The screen placing the grid gives it a container with overflow-x-auto. A card is overflow-hidden and will clip it.
- The grid may scroll horizontally because every column is essential and none can be dropped (section 10 rule 2). Screens where a column can be dropped must drop it instead.

### 31.4.1 Keyboard in the grid

Tab moves right and Enter moves down, as in a spreadsheet (section 39.6).

### 31.5 Saving

- One primary Save for the whole grid, in a fixed footer (section 11.3 rules 7 and 8).
- Never a Save per row or per cell.
- Validation follows section 11.3 rule 6: on leaving a cell, with the error below the grid and the offending cell bordered in danger.

## 34. Report tables

A report table is a read-only table whose purpose is a conclusion: one row per thing being compared, and a total row that is the answer the screen exists to give.

It is not a list page. A list page shows records you might open; a report shows figures you read together.

### 34.1 The total row is pinned

- On a report table with a total row, the total row is sticky, like the column header. The header says what a column means; the total says what the report concluded. Both must stay visible.
- Apply position: sticky to the footer cells as well as the tfoot. Some browsers ignore it on tfoot alone.
- The total row stays neutral and does not take the section 36 band: body strong on a surface-sunken fill, with a 2px primary line above it.

### 34.2 Do not paginate a report table

- A report shows every row and scrolls. A total that covers only the rows on page 2 is not a total.
- This is the exception to section 1 rule 7, and it applies only when both are true:
  1. the table has a pinned total row (section 34.1);
  2. its rows come from master data, growing only when an administrator edits a list. A table whose rows grow as the product is used is a list and paginates.

### 34.3 The first column freezes when the table scrolls sideways

- Where a report table is wider than its container, it scrolls horizontally (section 10 rule 2) and its first column freezes, with a 1px right border. The border is always present.
- The frozen column is the row spine: a th scope="row" (TableRowHeader), tinted primary-subtle, at body strong weight. The tint tells the eye this column names rather than measures.
- It is not a band (section 36.2): a band spans full width and a spine is a column.
- The tinted spine is only for tables with no row selection: report tables and data entry grids. On a list page, primary-subtle means "selected" (section 22.1), so a list page's frozen first column stays an ordinary cell and takes its row's selected state.
- In the footer row the tint is dropped; the total row owns that cell.
- Measure the fit in the running browser after any change to the column set.

### 34.4 One component, every scope

- A report and the same figures shown inside a single record are one component with a scope prop (section 4 rules 2 and 4), never two copies.
- Where several measures would multiply the columns (for example budget, actual, variance and percentage across five periods), show one measure at a time, chosen by a selector placed with the table. Fetch all measures in one response, so changing the selector redraws without refetching.
- The rows come from the master list, not from the query result. Every category appears, whether or not it has a figure.

## 35. Board view

A board shows one list's records as columns. Each column is one value of a single status field and each card is one record. It is the third view of a list page, beside list and card.

Worked example: a sales pipeline, with one column per stage and one card per deal. Moving a card moves the deal to another stage.

### 35.1 It is a view of a list page, not a page type

- Section 11.1's zones are unchanged. The board sits in zone 3, like card view.
- The view switcher becomes a three-way joined group (list, card, board), with the active side tinted primary-subtle.
- Search, filters and sort apply to the board unchanged.
- The user's choice of view is remembered (section 11.6).
- Switching view changes appearance only, never content.

### 35.2 When the board button appears

- Only on a list whose records carry a single status field with a small, fixed set of values, coming from master data (section 15.2).
- On any other list, the board button is hidden, not disabled. A board is not unavailable to this user; it does not exist for this record type.

### 35.3 Desktop and tablet only

- The board is available in the desktop layout at 768px and above.
- In the phone layout the board becomes a list of one status at a time (section 41.5). Below 768px in the desktop layout, the view switcher offers list and card only. A user whose remembered view was the board sees the list instead, silently. This is not an error.
- Do not build a mobile board. A board's only value is showing stages side by side.

### 35.4 Columns

1. One column per value of the status field, in the order the product defines (the order the work moves in). Never alphabetical, never by record count, never changing as records move.
2. One column for every value the status field declares, with no maximum. A board wider than its area scrolls sideways (section 35.8).
3. A column exists because the status field declares the value, not because a record holds it. An empty stage is still a column.
4. The column header shows the column's name and its true total: the count of records in that column under the current filters, not the number of cards rendered (section 35.7). The header sits outside the column's scrolling area, so it never scrolls away.
5. All columns look and behave identically. If one carries a count, they all do. A column is never tinted to mean something.
6. Column width is fixed (--spacing-board-column). Columns do not grow to fill spare width.

### 35.5 The card

- Section 11.6 governs the card: at most five pieces of information, all cards the same height, descriptions clamped to two lines, the whole card clickable.
- A card never shows its own status. The column it sits in is its status. (Section 11.1's "status is always a badge" applies to list rows, where nothing else shows the status.)
- A card's other status fields, such as a payment state, are shown as normal badges.

### 35.6 Moving a card

Every move (from the menu, the keyboard or a drag) is the same single call: this record, this destination column (onMove).

**The menu is the baseline and is never removed.**

- The card's three-dot menu has a "Move to" group listing every column except the one the card is in.
- The group label is a DropdownMenuLabel, so it must sit inside a DropdownMenuGroup (section 4.1).
- A move the user is not permitted to make is disabled with its reason (section 26). A disabled menu item cannot show its own tooltip, so use permission-tooltip.tsx.

**The move is optimistic, and a failure is visible.**

- The card appears in the destination column immediately.
- If the save fails, the card returns to its original column and an error toast states what happened: cause, then next action (sections 7.1, 7.2). Error toasts never auto-dismiss (section 25).
- A card never stays in a column the server did not agree to.
- Every move has a deadline (section 14 rule 4).

### 35.6.1 Dragging

- Dragging only decides the destination column. Everything after the drop (the optimistic move, the revert, the toast, the deadline) uses the same code as the menu.
- The menu path stays and keeps working. The board is fully operable without a mouse.
- The whole card is the drag source. There is no grip handle.
- A press that does not move is a click and opens the record (section 11.6). A press that moves 5px or more (--drag-threshold) is a drag. The click that fires at the end of a drag is swallowed, so a dropped card does not also open.

**Keyboard dragging**

- Space picks up the focused card. Left and Right move it to the previous or next column. Space drops it. Escape cancels.
- Enter opens the record. It never picks up a card.
- Left and Right move a whole column at a time and do not wrap past the first or last column.
- Up and Down do nothing. A drop goes to a column, never to a position inside it.

**Card order within a column** follows the list's sort (section 27.2), in every view. It is not user-arranged, and no sorting library is installed. Allowing hand-arranged cards would first need, in this order: a rule here on what an order means when the sort or filters change, a place to store it, and an action to save it.

**While dragging**

- The column the card would land in is tinted primary-subtle with a primary-border edge. The whole column is tinted, not a line inside it.
- The original card stays in place at reduced opacity while its copy follows the pointer at --shadow-dialog (section 5.4), so the column does not collapse under the drag.
- Every change is announced to screen readers: picking up, crossing into a column, dropping and cancelling, each naming the card and the column.

### 35.7 Volume: 25 cards, then Load more

- A column renders at most 25 cards, with a Load more control at its foot. The column header always shows the true total.
- The list page's pagination bar (zone 4) stays and reports the record count for the current filters. It does not page the board.

### 35.8 Scroll

The board's scroll shape is fixed:

- The board area has a fixed height, calculated from the window (section 11.1 zone 3).
- The board scrolls horizontally when its columns are wider than the space available. This is allowed because every column is essential (section 10 rule 2).
- Each column scrolls vertically, independently, inside its own fixed height.
- The page scrolls once, by a small fixed amount, and stops: exactly the height of zones 1a, 1b and 2 (section tabs, list banner and toolbar).

The page scroll above the column scroll is the one allowed exception to section 1 rule 8. It is allowed only when all four of these are true. If any one is missing, rule 8 applies.

1. The page's scroll range is small and fixed: the height of the chrome between the page header and the data area. The board area is exactly the height of the scrolling box, so the range cannot grow with the records.
2. The page header never moves. The title, record count and primary action sit outside the scrolling box.
3. The column headers come to rest against the page header and stay pinned there.
4. A downward scroll goes to the page first, wherever the pointer is, until the page's range is used up, then passes to the column mid-gesture. An upward scroll goes to the column under the pointer, unless that column is already at its top. (The browser does not do this on its own; it must be built.)

**The host container.** A board placed in a container that gives it no height shows one screen tall with its columns cut off. Where anything inside the host is sticky, the host clips with overflow: clip, not overflow: hidden. overflow: hidden turns the host into a scroll container, and sticky elements then stick to it instead of the page.

### 35.9 Empty columns and an empty board

- A column with no cards shows one line of text-muted saying it is empty. No heading, no illustration, no action.
- A board where every column is empty is an empty screen. It shows section 13's states in full, in place of the board: "nothing yet" when the list has no records, "nothing found" when filters or search matched none.

### 35.10 What the board is not

- Not a workflow editor. Columns are never added, renamed, reordered or deleted from the board; they are master data and are maintained where master data is maintained (section 15.2).
- Not a bulk selection surface. Tick boxes and the action bar (section 22) belong to list view.
- Not a second place to edit a record. The card opens the record.
