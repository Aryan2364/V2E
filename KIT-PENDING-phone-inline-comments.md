# Pending kit change: comments inline on the phone task, with a pinned comment box (owner decision, 2026-10-20)

Status: **wanted for v2e's phone layout, NOT in `kits/frontend-kit/FRONTEND_RULES_PHONE.md`.** v2e deliberately differs from kit §41.6 rule 5 on the points below. The kit itself is not to be edited from v2e.

**Why:** owner, 20 Oct 2026: writing a comment must not leave the task. Asana / Todoist pattern.

## What the kit says

§41.6 rule 5: a record's comments are a separate comments screen. The record shows a row or an "Add comment" action that opens that screen; the thread (comment-thread.tsx) and the comment box (comment-box.tsx) live there. The record's primary action sits in the fixed action bar at the bottom.

## What v2e does

1. **Inline thread.** The phone task detail shows the kit comment thread under the task's details: oldest first, "Show earlier" loading 10 at a time. The thread does NOT jump the page to the latest comment when the task opens (v2e prop `followLatest={false}` on CommentThread); the reader scrolls down to the comments and the latest are at the bottom, just above the box.
2. **Pinned comment box.** The kit comment box in its phone form is pinned to the bottom of the task detail screen: fixed above the keyboard, part of the bottom-bar contract (`data-fixed-bottom`), grows to 5 lines, Enter makes a new line, send inside the box. Sending appends the comment to the thread in place (no reload; with attachments the list is reloaded once, rows keep their keys). On failure the text stays and an error toast shows.
3. **Primary action moved.** "Complete task" / "Reopen task" is a full-width button at the top of the record under the title and facts (Asana's "Mark complete"), so the bottom belongs to the comment box. Every other action, and the tick/undo behaviour, is unchanged.
4. **No separate comments route.** There is none to remove: the old compose screen was an in-screen overlay, now deleted.

## Kit additions this relies on (also recorded in frontend/FRONTEND_RULES.md 4.1.1)

`CommentThread`: `followLatest`, `replyingTo`, `attachments`, `actions`, `dividerBefore`. `CommentBox`: `tools`, `attachments`, `hasContent`, `maxLength`, `error`, `textareaRef`, `onTextKeyDown`, `textareaProps`.

## Sections to amend

- §41.6 rule 5: allow the thread and the pinned box inline on a record when writing a comment should not leave it
- §41.6 / §41.5: the record's primary action may sit under the title when the bottom is taken by the comment box
- `components/ui/comment-thread.tsx`: optional `followLatest`
