"use client"

import * as React from "react"
import { SendHorizontalIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group"
import { enterSends } from "@/components/ui/keyboard-shortcuts"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/sonner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { fieldKeyboard } from "@/lib/field-keyboard"
import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"

/**
 * FRONTEND_RULES_PHONE.md 41.6 rule 5 and 41.7 rules 6 and 11: the message
 * box on a comments screen, fixed above the keyboard, with its send
 * button.
 *
 *   - "It grows with its text up to 5 lines, then scrolls inside itself":
 *     built on Textarea (which already grows with field-sizing-content),
 *     capped at 5lh on phone only, the same technique the kit's demo
 *     comments screen used, now owned by this one component.
 *   - "On phone Enter makes a new line and the send button sends" (rule
 *     6): plain textarea behaviour on phone (Enter is never intercepted
 *     there); on desktop Enter sends and Shift+Enter makes a new line
 *     (39.2), through enterSends, which already reads the layout at the
 *     moment of the key press.
 *   - "Sending uses Button's loading state... a failed send keeps the
 *     text and shows an error toast": `onSend` is awaited; a throw shows
 *     the thrown Error's message (the caller's cause-then-next-action
 *     text, 7.2 rule 2) as an error toast, and the text is left exactly
 *     as it was, because the component never clears it itself - clearing
 *     is the caller's job, done from its own onChange once the send
 *     really succeeded (as the kit's comments screen already does).
 *   - "It takes part in the bottom-bar contract so the page's content is
 *     padded above it": on phone, the box marks itself
 *     data-fixed-bottom="action-bar" and renders an identical invisible
 *     "ghost" copy in the page's own flow, pulled up by one action bar's
 *     height, so it adds only what the box has grown past that - exactly
 *     the globals.css --bottom-bar mechanism a page's real action bar
 *     uses (components/ui/action-bar.tsx, sheet.tsx's ActionBarFrame).
 *
 * The composer is ONE bordered box with the send button inside it, at its
 * bottom right, as in a chat app (6.5: the group owns the border, radius
 * and focus ring; the textarea and the button sit inside it). The send
 * button is icon-only and filled with primary: the box's one main action
 * (6.3's exception), the send arrow being in 23.1's map and the phone icon
 * set (41.9 rule 9). Its tooltip names it on a computer; on phone it has
 * none (41.8 rule 18) and its screen-reader label is the same words.
 * The visible "Comment" label is screen-reader only, as TopBarSearch's is:
 * the heading above the thread names the box, and the label stays real
 * (1 rule 12).
 *
 * On desktop this renders a plain, non-fixed row (comments are shown
 * inline on the record's Activity tab there, 41.6 rule 5), so a caller
 * that renders this component on both layouts never has to branch itself.
 */

/** Edge-to-edge inside the content area (kit content-area.tsx BLEED, inlined: v2e has no content-area shell). */
const BLEED =
  "mr-[calc(var(--content-bleed-right,0px)_*_-1)] ml-[calc(var(--content-bleed-left,0px)_*_-1)]"

/** 37.6: the box's own words, replaced by a product's strings file. */
const COMMENT_BOX_TEXT = {
  label: "Comment",
  /** The send button's tooltip and screen-reader name (it is icon-only, 6.3). */
  send: "Send comment",
  sending: "Sending",
  /** 7.2 rule 2: cause, then the next action - used only when `onSend` throws without its own message. */
  failed: "Something went wrong, so the comment was not sent. Try again.",
} as const

/*
 * The composer's classes, shared with the ghost so the two always have the
 * same height. min-h-control is the 36px field (44px on phone, 41.9 rule 2);
 * the group grows past it with the text, and the button stays at the bottom
 * right. The textarea has no minimum of its own (the group is the field), and
 * on phone it stops at 5 lines and scrolls inside itself (41.7 rule 11): 5
 * lines plus its 16px of padding, the border now being the group's.
 */
const COMPOSER = "min-h-control items-end"
const FIELD =
  "min-h-0 min-w-0 phone:max-h-[calc(5lh_+_var(--spacing)_*_4)]! phone:overflow-y-auto! phone:overscroll-y-contain"
/** 4px around the in-field button (space-1), not the addon's 6px and 8px: the box stays one field tall. */
const ADDON = "self-end p-1 has-[>button]:mr-0"

function CommentBox({
  value,
  onChange,
  onSend,
  label = COMMENT_BOX_TEXT.label,
  placeholder,
  disabled = false,
  className,
  tools,
  attachments,
  hasContent = false,
  maxLength,
  error,
  textareaRef,
  onTextKeyDown,
  textareaProps,
}: {
  value: string
  onChange: (text: string) => void
  /** Sends `value`. Throw (or reject) with an Error to report a failed send; its message is the toast. */
  onSend: () => void | Promise<void>
  label?: string
  placeholder?: string
  disabled?: boolean
  className?: string
  /*
   * v2e additions (frontend/FRONTEND_RULES.md 4.1.1): a comment that
   * carries files, a reply, or a length limit.
   */
  /** Icon buttons inside the box, left of Send (an "Attach" button). */
  tools?: React.ReactNode
  /** Chips for what is attached, in a row right above the box. */
  attachments?: React.ReactNode
  /** Something other than text will be sent (a file), so Send is allowed with an empty text. */
  hasContent?: boolean
  maxLength?: number
  /** A failed send the caller reports in the box rather than as a toast. */
  error?: string | null
  textareaRef?: React.Ref<HTMLTextAreaElement>
  /** Runs before the Enter-sends rule; calling preventDefault() on the event keeps the box from sending (an open @mention list). */
  onTextKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  /** Extra attributes for the textarea (aria-*, onClick, onBlur). */
  textareaProps?: Omit<
    React.ComponentProps<"textarea">,
    "value" | "onChange" | "onKeyDown" | "id" | "className" | "disabled" | "placeholder" | "maxLength" | "ref"
  >
}) {
  const { layout } = useLayout()
  const phone = layout === "phone"
  const [sending, setSending] = React.useState(false)
  const id = React.useId()

  const canSend = (value.trim().length > 0 || hasContent) && !sending && !disabled

  const send = React.useCallback(async () => {
    if (!canSend) return
    setSending(true)
    try {
      await onSend()
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : COMMENT_BOX_TEXT.failed)
    } finally {
      setSending(false)
    }
  }, [canSend, onSend])

  const form = (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
      className={cn(
        "w-full",
        // The 600px column is the phone's (41.13 rule 10); on desktop the
        // row takes its container's width, as a textarea may (4.1).
        phone ? "mx-auto max-w-phone-column p-3" : "py-3"
      )}
    >
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      {attachments ? <div className="mb-2 flex flex-wrap gap-1.5">{attachments}</div> : null}
      <InputGroup className={COMPOSER}>
        <InputGroupTextarea
          id={id}
          ref={textareaRef}
          maxLength={maxLength}
          {...fieldKeyboard("longText")}
          className={FIELD}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          {...textareaProps}
          onKeyDown={(event) => {
            onTextKeyDown?.(event)
            if (event.defaultPrevented) return
            enterSends(send)(event)
          }}
        />
        <InputGroupAddon align="inline-end" className={ADDON}>
          {tools}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="submit"
                  size="icon-sm"
                  aria-label={COMMENT_BOX_TEXT.send}
                  disabled={!canSend}
                  loading={sending}
                >
                  <SendHorizontalIcon />
                </Button>
              }
            />
            <TooltipContent side="top">{COMMENT_BOX_TEXT.send}</TooltipContent>
          </Tooltip>
        </InputGroupAddon>
      </InputGroup>
      {error ? (
        <p role="alert" className="mt-2 text-meta text-danger">
          {error}
        </p>
      ) : null}
    </form>
  )

  if (!phone) {
    return (
      <div className={cn("border-t border-border-light bg-surface", className)}>{form}</div>
    )
  }

  return (
    <>
      {/* The bottom-bar contract's ghost: invisible, out of the tab
          order, holding whatever height the real box has grown past one
          action bar's (globals.css derives --bottom-bar from the real
          box's data-fixed-bottom mark alone). */}
      <div
        aria-hidden
        inert
        className={cn("invisible mt-[calc(var(--h-action-bar)_*_-1)] border-t border-border-light", BLEED)}
      >
        <GhostField value={value} />
      </div>
      <div
        data-fixed-bottom="action-bar"
        className={cn(
          "fixed inset-x-0 bottom-keyboard-inset z-(--z-shell) border-t border-border-light bg-surface pr-safe-right pb-safe-bottom pl-safe-left",
          className
        )}
      >
        {form}
      </div>
    </>
  )
}

/** The ghost copy: same text, so it grows line for line with the real box, but reachable by nobody. */
function GhostField({ value }: { value: string }) {
  return (
    <div className="mx-auto w-full max-w-phone-column p-3">
      <InputGroup className={COMPOSER}>
        <InputGroupTextarea tabIndex={-1} readOnly value={value} className={FIELD} />
        <InputGroupAddon align="inline-end" className={ADDON}>
          <Button type="button" size="icon-sm" tabIndex={-1} aria-label={COMMENT_BOX_TEXT.send}>
            <SendHorizontalIcon />
          </Button>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

export { CommentBox, COMMENT_BOX_TEXT }
