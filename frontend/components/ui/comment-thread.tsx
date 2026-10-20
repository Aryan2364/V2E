"use client"

import * as React from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDate, formatDay, formatTime } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"

/**
 * The conversation above the comment box (FRONTEND_RULES_PHONE.md 41.6
 * rule 5; section 38.2 for "Edited"). One look on a computer and a phone:
 * the list of a team's comments on a record, read like a thread but laid
 * out as entries, not chat bubbles. Comments on a record are a trail
 * people come back to, from many people, often long, so every entry
 * takes the full width and the thread stays scannable. Bubbles are not
 * built; a product with a live conversation asks first (section 0).
 *
 *   - Oldest at the top, newest at the bottom, the comment box below
 *     (comment-box.tsx). `items` come in that order. The thread opens
 *     scrolled to the latest, and stays on the latest when a new one
 *     arrives while the person is at the bottom.
 *   - Each comment: the person's photo (avatar.tsx, their initials when
 *     there is no photo), their name, the time (formatTime, section 18),
 *     then the text under it, whole, line breaks kept.
 *   - Several in a row from one person on one day sit together: the
 *     name, photo and time show once, on the first; each later one is
 *     its text with its own time under it.
 *   - A day divider ("Today", "Yesterday", then DD Mon YYYY: formatDay,
 *     section 18) opens each day.
 *   - "Edited" beside the time once a comment was changed. With
 *     `onShowEdits` it is a button that opens the earlier versions
 *     (38.2); without, plain text.
 *   - `tag` is a small neutral badge beside the name ("Client",
 *     "Internal"): the product's word, since who counts as a client is
 *     the product's rule (37.6: from its strings file).
 *   - A note is a one-line grey line, centred between comments: "Priya
 *     uploaded round 2". The product writes its text. The record's full
 *     edit history stays on its Activity tab (38.2), newest first; a
 *     note is for the few events a conversation should read around.
 *
 * Scrolling (10): on a computer it is the fixed-height live feed of
 * "a card scrolls internally only when it is a fixed-height live feed":
 * it scrolls inside itself, no taller than --spacing-thread-max. On
 * phone the page scrolls, and the fixed comment box sits over its end
 * through the bottom-bar contract (comment-box.tsx), so the thread
 * pads nothing itself. When earlier comments are added at the top, what
 * the person was reading stays where it is.
 *
 * Earlier comments load with "Show earlier" at the top, 10 at a time
 * (41.6 rule 5). Loading is a skeleton (14 rule 1); a thread that
 * failed to load is the product's failed empty state, not this part's.
 */

/** 37.6: the thread's own words, replaced by a product's strings file. */
const COMMENT_THREAD_TEXT = {
  label: "Comments",
  edited: "Edited",
  editedAction: "Show earlier versions of this comment",
  showEarlier: "Show earlier",
  showingEarlier: "Loading",
  emptyHeading: "No comments yet",
  emptyLine: "Write the first one below.",
  emptyAction: "Write a comment",
} as const

type ThreadComment = {
  kind?: "comment"
  id: string
  /** The person's name: "Rakesh Mehta". */
  who: string
  /** Their photo, when they have one. */
  photo?: string
  /** When it was written. A Date, or an ISO string as the server sends it. */
  when: Date | string
  /** The comment's text, whole. Line breaks are kept. */
  text: React.ReactNode
  /** True once the comment was changed after it was sent (38.2). */
  edited?: boolean
  /** Opens the earlier versions. Leave out where the product keeps none. */
  onShowEdits?: () => void
  /** A small badge beside the name: "Client", "Internal". The product's word. */
  tag?: string
  /*
   * v2e additions (frontend/FRONTEND_RULES.md 4.1.1): what a record's
   * comments carry beyond the kit's text.
   */
  /** This comment answers another: that person's name, shown as "Replying to Name" above the text. */
  replyingTo?: string
  /** Files or links sent with the comment, shown under the text. */
  attachments?: React.ReactNode
  /** The comment's own controls (Reply, Delete, ...), on a row under the text. */
  actions?: React.ReactNode
}

type ThreadNote = {
  kind: "note"
  id: string
  when: Date | string
  /** One line: "Priya uploaded round 2". */
  text: React.ReactNode
}

type ThreadItem = ThreadComment | ThreadNote

/** "Rakesh Mehta" -> "RM"; one word -> its first letter. */
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ""
  const first = words[0][0]
  const last = words.length > 1 ? words[words.length - 1][0] : ""
  return (first + last).toUpperCase()
}

/** The calendar day an item falls on, as the divider would print it: equal strings are one day. */
function dayOf(when: Date | string) {
  return formatDate(when)
}

/** The machine-readable time for a <time> element; empty when the value cannot be read. */
function isoOf(when: Date | string) {
  const date = new Date(when)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** How far from the end still counts as "at the bottom": a new comment then keeps the view on the latest. */
const NEAR_END = 80

/** The "Edited" button's look: an inline text control (6.7), at meta size, with the tap area of 9 rule 4. */
const EDITED_BUTTON =
  "tap-area cursor-pointer rounded-sm text-primary-text underline outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring"

function CommentThread({
  items,
  hasEarlier = false,
  onShowEarlier,
  loading = false,
  onWrite,
  label = COMMENT_THREAD_TEXT.label,
  className,
}: {
  /** Oldest first. Comments and notes together. */
  items: ThreadItem[]
  /** There are older comments not in `items`. Shows "Show earlier" at the top. */
  hasEarlier?: boolean
  /** Loads the next 10 older ones into the front of `items`. */
  onShowEarlier?: () => void | Promise<unknown>
  /** The first load is under way: skeletons in the shape of three comments. */
  loading?: boolean
  /** The empty state's action: put the cursor in the comment box. */
  onWrite?: () => void
  /** The list's name for a screen reader. */
  label?: string
  className?: string
}) {
  const { layout } = useLayout()
  const phone = layout === "phone"
  const scroller = React.useRef<HTMLDivElement | null>(null)
  const list = React.useRef<HTMLOListElement | null>(null)
  const [pending, setPending] = React.useState(false)
  // Moment the thread was drawn, for "Today" and "Yesterday". It is read
  // on the server and again in the browser; the two can differ only across
  // midnight, so the divider suppresses that one text mismatch.
  const now = new Date()

  /*
   * Scroll bookkeeping, kept between renders. `before` is what the thread
   * looked like when `items` last changed: how tall it was, where the
   * person was, and which items were first and last. Compared with the
   * new items it tells three cases apart: the first draw (go to the
   * latest), a new comment at the end (follow it only if the person was
   * at the bottom), and older comments at the top (keep what they were
   * reading where it was).
   */
  const before = React.useRef<{
    height: number
    top: number
    atEnd: boolean
    firstId: string | undefined
    lastId: string | undefined
  } | null>(null)

  const measure = React.useCallback(() => {
    const el = scroller.current
    if (phone || !el) {
      const doc = document.documentElement
      return {
        height: doc.scrollHeight,
        top: window.scrollY,
        atEnd: doc.scrollHeight - window.scrollY - window.innerHeight <= NEAR_END,
      }
    }
    return { height: el.scrollHeight, top: el.scrollTop, atEnd: el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_END }
  }, [phone])

  const scrollTo = React.useCallback(
    (top: number) => {
      const el = scroller.current
      if (phone || !el) window.scrollTo({ top })
      else el.scrollTop = top
    },
    [phone]
  )

  React.useLayoutEffect(() => {
    if (loading || items.length === 0) return
    const first = items[0].id
    const last = items[items.length - 1].id
    const prev = before.current
    const size = measure()

    if (prev === null) {
      // First draw: the latest, just above the box.
      scrollTo(size.height)
    } else if (last !== prev.lastId && first === prev.firstId) {
      // A new comment at the end: follow it if the person was at the bottom.
      if (prev.atEnd) scrollTo(size.height)
    } else if (first !== prev.firstId && last === prev.lastId) {
      // Older ones at the top: the same comments stay under the thumb.
      scrollTo(prev.top + (size.height - prev.height))
      // 39.3: focus lands on the first of what arrived, without moving the view.
      list.current?.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(first)}"]`)?.focus({ preventScroll: true })
    }

    before.current = { ...measure(), firstId: first, lastId: last }
  }, [items, loading, measure, scrollTo])

  // The page or the feed scrolled: remember whether the person is at the
  // bottom. The feed's element exists only once there is something to
  // show, so this runs again then.
  const shown = !loading && items.length > 0
  React.useEffect(() => {
    if (!shown) return
    const el = scroller.current
    const target: HTMLElement | Window = phone || !el ? window : el
    const onScroll = () => {
      if (before.current) before.current = { ...before.current, ...measure() }
    }
    target.addEventListener("scroll", onScroll, { passive: true })
    return () => target.removeEventListener("scroll", onScroll)
  }, [phone, measure, shown])

  const showEarlier = () => {
    if (!onShowEarlier) return
    const loadingEarlier = onShowEarlier()
    if (loadingEarlier instanceof Promise) {
      setPending(true)
      loadingEarlier.then(
        () => setPending(false),
        () => setPending(false)
      )
    }
  }

  if (loading) {
    return (
      <div data-slot="comment-thread" aria-busy className={cn("flex flex-col gap-4", className)}>
        {[0, 1, 2].map((n) => (
          <div key={n} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <EmptyState
        variant="nothing-yet"
        heading={COMMENT_THREAD_TEXT.emptyHeading}
        actionLabel={COMMENT_THREAD_TEXT.emptyAction}
        onAction={onWrite}
        className={className}
      >
        {COMMENT_THREAD_TEXT.emptyLine}
      </EmptyState>
    )
  }

  return (
    <div
      ref={scroller}
      data-slot="comment-thread"
      // The browser's own scroll anchoring would move the view when older
      // comments are added at the top, on top of the correction made
      // above; it is off here so only one of the two acts.
      className={cn("[overflow-anchor:none]", !phone && "max-h-thread-max overflow-y-auto overscroll-y-contain", className)}
    >
      {hasEarlier ? (
        <div className="flex justify-center pb-4">
          <Button variant="secondary" size="sm" onClick={showEarlier} loading={pending} loadingLabel={COMMENT_THREAD_TEXT.showingEarlier}>
            {COMMENT_THREAD_TEXT.showEarlier}
          </Button>
        </div>
      ) : null}
      <ol ref={list} aria-label={label} className="flex flex-col">
        {items.map((item, index) => {
          const previous = items[index - 1]
          const newDay = !previous || dayOf(previous.when) !== dayOf(item.when)
          // Grouped under the person above: a comment right after one by
          // the same person on the same day, with no note between.
          const grouped =
            !newDay && item.kind !== "note" && previous?.kind !== "note" && previous?.who === item.who
          // 5.2: related items sit closer than unrelated ones. 4px inside a
          // group, 16px between people; a day divider brings its own space.
          const space = index === 0 || newDay ? "" : grouped ? "pt-1" : "pt-4"

          return (
            <React.Fragment key={item.id}>
              {newDay ? (
                // Its own row, so the space above it is not part of the
                // comment's row: a comment keeps its place when the rows
                // above change.
                <li className={cn("flex items-center gap-3 pb-4 text-meta text-text-secondary", index > 0 && "pt-6")}>
                  <span aria-hidden className="h-px flex-1 bg-border-light" />
                  <span suppressHydrationWarning>{formatDay(item.when, now)}</span>
                  <span aria-hidden className="h-px flex-1 bg-border-light" />
                </li>
              ) : null}
              <li
                data-thread-id={item.id}
                // Focusable by script only (39.3), never a Tab stop.
                tabIndex={-1}
                className={cn("min-w-0 rounded-sm outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring", space)}
              >
                {item.kind === "note" ? (
                  <p className="py-1 text-center text-meta wrap-break-word text-text-secondary">
                    {item.text} · <time dateTime={isoOf(item.when)}>{formatTime(item.when)}</time>
                  </p>
                ) : (
                  <Entry comment={item} grouped={grouped} />
                )}
              </li>
            </React.Fragment>
          )
        })}
      </ol>
    </div>
  )
}

function Entry({ comment, grouped }: { comment: ThreadComment; grouped: boolean }) {
  const time = (
    <time dateTime={isoOf(comment.when)} className="text-meta whitespace-nowrap text-text-muted">
      {formatTime(comment.when)}
    </time>
  )
  const edited = comment.edited ? (
    comment.onShowEdits ? (
      <button
        type="button"
        onClick={comment.onShowEdits}
        aria-label={COMMENT_THREAD_TEXT.editedAction}
        className={cn(EDITED_BUTTON, "text-meta")}
      >
        {COMMENT_THREAD_TEXT.edited}
      </button>
    ) : (
      <span className="text-meta text-text-muted">{COMMENT_THREAD_TEXT.edited}</span>
    )
  ) : null

  const text = (
    <div className="flex min-w-0 flex-col gap-1">
      {comment.replyingTo ? (
        <p className="text-meta text-text-secondary">Replying to {comment.replyingTo}</p>
      ) : null}
      <div className="text-body wrap-break-word whitespace-pre-line text-text-primary">{comment.text}</div>
      {comment.attachments}
      {comment.actions ? <div className="flex flex-wrap items-center gap-2">{comment.actions}</div> : null}
    </div>
  )

  if (grouped) {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        {text}
        <p className="flex items-center gap-2">
          {time}
          {edited}
        </p>
      </div>
    )
  }

  return (
    <article className="flex min-w-0 flex-col gap-2">
      <header className="flex min-w-0 items-center gap-2">
        <Avatar size="default">
          {comment.photo ? <AvatarImage src={comment.photo} alt="" /> : null}
          <AvatarFallback>{initials(comment.who)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 truncate text-body font-medium text-text-primary">{comment.who}</span>
        {comment.tag ? <Badge variant="neutral">{comment.tag}</Badge> : null}
        {time}
        {edited}
      </header>
      {text}
    </article>
  )
}

export { CommentThread, COMMENT_THREAD_TEXT }
export type { ThreadItem, ThreadComment, ThreadNote }
