# Authorization Rules (READ BEFORE ADDING/EDITING ANY ENDPOINT)

This app is **multi-tenant B2B**. The single most common and highest-severity bug
class here is **Broken Object-Level Authorization (BOLA / IDOR)**: an endpoint
identifies a record by `:id` and filters only by `organization_id` + existence,
without checking the caller is allowed to see or mutate *that specific row*. The
result is that any authenticated org member can read or mutate any record in their
org — or, when the `organization_id` filter is also missing, any record in *any*
org — by pasting or guessing an id.

> How a person *signs in* and how the session is carried (access / refresh / selection
> tokens, the httpOnly refresh cookie) is in [AUTHENTICATION.md](AUTHENTICATION.md). This
> file is about what a signed-in person may do.

**The guards do NOT save you.** `JwtAuthGuard` proves identity, `OrgScopeGuard`
proves the caller's active org equals the path `:orgId`, `RolesGuard` enforces only
coarse `@RequireAdmin`/`@RequirePermission` action gates. **None of them enforce
row-level scope.** Row-level authorization is your responsibility in the service.

## The mental model

Two independent questions must BOTH be answered for every single-record route:

1. **Action** — "may this actor perform `read`/`edit`/`delete` on this *kind* of
   record at all?" → answered by `@RequirePermission` / `hasEffective` / admin gate.
2. **Object** — "of the records they may act on, is *this specific row* one of
   them?" → answered by **participation** (they're on the record) **OR data scope**
   (`own`/`team`/`department`/`org`) over the record's core participants.

Filtering by `organization_id` answers neither. You must answer #2 explicitly.

## The toolkit — REUSE IT, never invent new auth

- **`ScopeService.assertCanActOn(orgId, principal, leafKey, action, participantUserIds[])`**
  (`src/access-rights/scope.service.ts`) — the single-record gate. Throws
  `ForbiddenException` unless a participant is within the caller's effective scope
  for that `PermissionAction`. Fails closed.
- **`ScopeService.listWhere(orgId, principal, leafKey)`** — the `where` fragment to
  spread into list queries so list visibility can't be forgotten.
- **`scope-registry.ts`** — the catalog of scopable content leaves and each one's
  `whereForUsers(ids)`, which *defines who "participates"* in a row (the core
  participants). Look your module up here to learn its leaf key and participant set.
- **`Principal` + `principalFromUser(req.user)`** (`permissions.service.ts`).
- **`PermissionAction`** from `@prisma/client` (`read`/`edit`/`delete`/…).

## The required pattern (canonical reference: `src/tasks/tasks.service.ts`)

For every route that reads or mutates a single record by id:

```ts
// 1. A reusable per-service guard. Principal is OPTIONAL so internal
//    service-to-service calls (post-mutation reads) skip the gate — only the
//    HTTP controller passes a real principal.
async assertCanViewX(orgId: string, principal: Principal | undefined, id: string) {
  if (!principal) return;                       // internal caller, already authorized
  const row = await this.prisma.x.findFirst({
    where: { id, organization_id: orgId },      // org scope is necessary, NOT sufficient
    select: { created_by_user_id: true, /* + assignees/members/etc. */ },
  });
  if (!row) throw new NotFoundException('X not found');
  await this.assertParticipantAction(orgId, principal, row, PermissionAction.read);
}

private async assertParticipantAction(orgId, principal, row, action) {
  // 2. Direct participants act freely — a narrow scope grant must never block
  //    someone who is literally on the record.
  const onRecord = row.created_by_user_id === principal.userId /* || assignee/member... */;
  if (onRecord) return;
  // 3. Everyone else must hold `action` scope over a core participant.
  await this.scope.assertCanActOn(orgId, principal, X_LEAF, action, [
    row.created_by_user_id, /* ...assignees/members (core participants only) */
  ]);
}
```

Controller wires the principal in:
```ts
@Get(':id')
getOne(@Param('orgId') orgId, @Param('id') id, @Request() req) {
  return this.service.getX(orgId, id, principalFromUser(req.user)); // principal LAST, optional
}
```

## Hard rules

1. **Every `:id` read/mutate route gates the object**, not just the action. This
   includes sub-resources reached by their own id: comments, attachments,
   **download / signed-URL routes**, activity logs, members, line items, schedule
   entries, milestones, check-ins, reactions, notifications.
2. **Sub-resources must be scoped to their parent AND org in the query.** Never
   `prisma.child.update({ where: { id: childId } })`. Always
   `findFirst({ where: { id: childId, parent_id, organization_id } })` first (404 on
   miss), then act. A bare `where: { id }` is a cross-parent/cross-org IDOR.
3. **`organization_id` belongs in EVERY single-record `where`.** Its absence is a
   cross-org IDOR even when a participant/owner check exists.
4. **Recipient/owner-scoped rows** (notifications, push subscriptions, private
   notes, my-assignments) filter by `user_id` in the query. Use `updateMany`/
   `deleteMany` with `{ id, organization_id, user_id }` and treat `count === 0` as
   `NotFound` — never `update({ where: { id } })`.
5. **Deletion is entitlement-only.** Being a participant grants read/edit, but NOT
   the right to destroy a record. For `delete`, skip the participant shortcut and
   go straight to `assertCanActOn(..., PermissionAction.delete, ...)`.
6. **Action gates are scope-BLIND.** `permissions.hasEffective(...'edit')` proves
   the *action* entitlement, not that it covers *this row*. If you use it as a
   manage/edit fallback, you MUST additionally call `assertCanActOn` so an
   `own`/`team`-scoped grant isn't a skeleton key for every record in the org.
7. **`principal` is optional and comes last.** Skip the gate when it's absent so
   internal service-to-service calls (which pass no principal) keep working. Only
   the HTTP controller passes `principalFromUser(req.user)`.
8. **Fail CLOSED and non-leaky.** On any ambiguity deny. Return
   `NotFound`/`Forbidden` — never echo the row's data in the denial.
9. **No registered leaf for your module?** Don't hand-roll auth. Add a leaf to
   `scope-registry.ts` (with its `whereForUsers` participant definition) and wire
   `listWhere` into the list query, or classify it `self_scoped` / `org_default`
   with a written justification. `org_default` (broadcast) content still needs
   **author-or-admin** gates on its write/delete routes.
10. **New controller?** Apply `OrgScopeGuard` (a missing one is an instant cross-org
    hole) plus the appropriate `@RequirePermission`/`@RequireAdmin`, THEN the
    row-level service gate above. All three layers, every time.

## WebSocket / gateway authorization

`@UseGuards` on a controller does **nothing** for a `@WebSocketGateway`. Sockets
have no `JwtAuthGuard`, no `OrgScopeGuard`, and no request pipeline — you must
authenticate and authorize them yourself, or you get an unauthenticated,
cross-tenant firehose (this was SECURITY_AUDIT C4/C5).

1. **Authenticate the handshake, before connect.** Register a namespace
   middleware in `afterInit` (`server.use(...)`) that verifies the access-token
   JWT via **`WsAuthService.authenticate(socket)`** and refuses the connection
   (`next(new Error('unauthorized'))`) on any failure. Do NOT authenticate only in
   `handleConnection` — a client can emit before it resolves.
2. **Identity comes ONLY from the verified token.** Derive `userId` and
   `organizationId` from the token and stash them on `socket.data`. **Never** read
   a userId or orgId from `handshake.auth`, a message payload, or any other
   client-supplied field — that is the socket equivalent of trusting a body-supplied
   `organization_id`.
3. **Authorize every message.** Each `@SubscribeMessage` handler must read
   `socket.data.userId` / `socket.data.organizationId` and run the SAME row-level
   gate an HTTP route would (membership / `assertCanActOn`) before it reads or
   broadcasts. A room subscribe (`join`) is a read — gate it by membership so a
   socket can't receive a conversation's future broadcasts it couldn't read over HTTP.
4. **Import `WsAuthModule`** in any module that declares a gateway; reuse
   `WsAuthService`, never hand-roll token parsing. Canonical references:
   `notifications.gateway.ts`, `messaging/chat.gateway.ts`.

## Self-check before shipping any endpoint

- [ ] Could another org member read/mutate a row they're not on by supplying its id?
- [ ] Does every single-record `where` include `organization_id`?
- [ ] Are sub-resources scoped to their parent id in the query, not just the parent route?
- [ ] Is delete gated by entitlement (not just participation)?
- [ ] Does any `hasEffective`/action-only check also verify scope over the row?
- [ ] Do internal callers still work (principal optional, gate skipped when absent)?
- [ ] Is the denial `NotFound`/`Forbidden` with no row data leaked?

If you can't answer all of these, the endpoint is not done.
