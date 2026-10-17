# Server-side pagination — inventory and plan

Inventory of list endpoints whose rows grow without bound, ranked by expected
row count × usage. "Client-side" means the frontend screen fetches the whole
set today and filters/sorts/searches in the browser.

| Rank | List | Endpoint | Frontend screen(s) | Client-side search/filter/sort today | Phone callers |
|---|---|---|---|---|---|
| 1 | Tickets | `GET /org/:orgId/tickets` (+ `/my`, `/assigned`) | `dashboard/tasks/tickets/page.tsx` (and `/my`, `/assigned`) | No — filters already server-side; just unpaginated | None known |
| 2 | Meetings | `GET /org/:orgId/meetings` | `dashboard/governance/meetings/page.tsx` | No — filters server-side; just unpaginated | None (meetings not in phone scope yet) |
| 3 | Knowledge posts | `GET /org/:orgId/knowledge` | `communication/knowledge/page.tsx` | No — filters server-side; just unpaginated | None |
| 4 | Announcements | `GET /org/:orgId/announcements` | `communication/announcements/page.tsx` | No — filters server-side; just unpaginated | None |
| 5 | Audit logs | `GET /org/:orgId/audit` | `settings/system/audit-logs/page.tsx` | Backend already supports `skip`/`take` + `count()`; frontend never asked for page 2 | None |
| — | Tasks (Work dashboard) | `GET /org/:orgId/tasks/paged` | Work dashboard | Already paginated (`listTasksPaged`, page/pageSize/sort). **Reference implementation — no work needed.** | n/a |
| — | Notifications | `GET /org/:orgId/notifications` | Notification panel + `/notifications` list, phone notifications screen | Already cursor-paginated (`cursor`/`limit`). Different shape (cursor, not page), but already server-side and already correct for phone's 25-at-a-time. **No work needed.** | Yes — must not change shape |
| — | Employees directory | `GET /org/:orgId/employees` (`findAll`) | `settings/organization/employees/page.tsx` | Yes — search + department filter run in the browser | Not on phone |
| — | Work logs (submissions/demands) | several `work-logs` endpoints | `governance/work-log/**` | Per-writer/per-day views, not a flat growing list | Not on phone |
| — | Tickets archive | `GET /org/:orgId/tickets/archive` | `tasks/tickets/archive/page.tsx` | No | None |
| — | Ticket notifications | `GET /org/:orgId/tickets/notifications` | — | No | None |

## Top 5 picked for this pass

1. **Tickets** (`listTickets`, backs `/`, `/my`, `/assigned`) — done.
2. **Meetings** (`MeetingsService.list`) — done.
3. **Knowledge posts** (`KnowledgeService.findAll`) — done.
4. **Announcements** (`AnnouncementsService.findAll`) — done.
5. **Audit logs** — backend already paginated (`skip`/`take`/`count`); only the
   frontend was missing a page-2 affordance. Wired to the kit `Pagination` +
   `lib/list-address.ts`.

## Skipped

- **Employees directory** (`EmployeesService.findAll`). The same unpaginated
  array backs three things that genuinely need the *whole* org: the tree view
  (`EmployeeTreeView`, built from the full reporting graph), the Add-Employee
  modal's manager/duplicate checks, and `getReportingTree`. Paginating the
  table view alone would leave the tree view, which is the more interesting
  of the two on a page people flip to constantly, needing a second
  unpaginated fetch anyway — so nothing is actually saved. Flagged as the
  next candidate once/if the tree view gets its own lighter endpoint.
- **Work logs.** The screens under `governance/work-log/**` are per-writer,
  per-day views (a timesheet), not a flat growing list in the kit's list-page
  sense; there's no single "all rows" query to paginate.

## Already fine, no action needed

- **Tasks** (`TasksService.listTasksPaged`) — the existing reference
  implementation this whole exercise is modelled on.
- **Notifications** — already cursor-paginated server-side; phone depends on
  this exact shape, so it is left untouched.
