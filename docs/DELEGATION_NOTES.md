# Delegation — feature notes & how to re-enable "Delegated to me"

_Last updated: 2026-07-20_

## What Delegation is
A management hand-off: a **delegator** transfers ownership of an outcome to an
**owner**, with measurable success criteria and a first check-in date. Creating a
delegation auto-spawns a **review task** for the delegator, due on the first
check-in date.

- Lives inside **Work → Delegation** (`/dashboard/tasks/delegation`).
- Gated by the **`delegation` entitlement** (OFF by default; turned on per-org from
  the super-admin portal → Module Entitlements). Currently ON for Shree Apex.

## Access rights (Setup → Access Rights → Delegations)
Two permission actions, both **admin-implicit** and **OFF for every other role by
default**:

| Action | Meaning |
| ------ | ------- |
| **Create** (`write`) | Who may delegate (create a delegation). |
| **Delete** (`delete`) | Who may permanently delete a delegation. |

`read`/`edit` are **not** permission-gated — they stay participation-based (the
delegator and the owner can view/edit their own). Leaf key:
`delegation.delegation.manage`.

## Current state — "Delegated to me" is HIDDEN (manager's call, 2026-07-20)
The recipient/tracking view was judged too much oversight for now, so it is
**commented out, not deleted**. Because a pure recipient's only reason to visit was
that tab, Delegation is currently a **delegators-only** tool:

- The **"Delegated to me" tab** is hidden.
- The page **doesn't fetch** incoming data.
- The **Work sidebar "Delegation" entry is hidden** for anyone who can't delegate.
- A non-delegator who hits the URL directly sees a friendly "not available to you"
  message.

The backend is **untouched** — `GET /api/v1/org/:orgId/delegations?view=incoming`
still works and `DelegationView` still includes `'incoming'`. Re-enabling is a
frontend-only change.

---

## HOW TO SWITCH "Delegated to me" BACK ON

### 1. `frontend/app/dashboard/tasks/delegation/page.tsx`
- In the `tabs` `useMemo`, **uncomment** `t.push('incoming')`.
- In `load()`, add `'incoming'` back into the `views` arrays:
  `isAdmin ? ['all', 'mine', 'incoming'] : ['mine', 'incoming']`.
- **Relax the page gate** so recipients (owners) can open the page. The block
  `if (!canDelegate) { …"isn't available to you"… }` currently walls out
  non-delegators. Either remove it, or change the condition so someone who is an
  owner of at least one delegation is allowed through (e.g. allow when
  `canDelegate || (lists['incoming']?.length ?? 0) > 0`).
- (Optional) Restore the smarter default-tab logic if you want recipients to land
  on "Delegated to me" — currently it defaults to `'mine'`.

### 2. `frontend/components/layout/TaskModuleSidebar.tsx`
- **Relax the nav gate.** Remove (or loosen) this line so recipients see the entry
  again:
  ```ts
  if (group.module === 'delegation' && !canDelegate) return null
  ```
  If you want recipients to see it, drop the line entirely (the section then shows
  whenever the `delegation` entitlement is on), or widen `canDelegate` to also
  include "is an owner of any delegation".

### 3. No backend changes needed
The `incoming` list endpoint and the `DelegationView` type are already in place.

---

## Related files
- Backend: `backend/src/delegation/` (controller, service, dto),
  `backend/src/access-rights/permission-registry.ts` (the `delegation` module +
  leaf), `backend/src/common/guards/org-scope.guard.ts` (`delegations → delegation`
  entitlement mapping), `backend/prisma/schema.prisma` (`Delegation`,
  `DelegationCriterion`, `DelegationStatus`).
- Frontend: `frontend/app/dashboard/tasks/delegation/page.tsx`,
  `frontend/components/delegation/*`, `frontend/lib/api/delegations.ts`.
