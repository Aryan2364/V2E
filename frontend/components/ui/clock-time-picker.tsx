"use client"

import * as React from "react"
import { ToggleGroup } from "@base-ui/react/toggle-group"
import { Toggle } from "@base-ui/react/toggle"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { TimeValue } from "@/components/ui/time-picker"

/**
 * v2e deviation from section 20.2 (owner decision, 20 Oct 2026): on desktop
 * the time field's picker is an analog clock face in a dialog, not the
 * kit's hour / minute / AM-PM option lists. The owner finds option lists a
 * poor way to show time. Typing in the field stays (20.2 "typeable"); the
 * phone still opens its own native picker (41.9 rule 10). Proposed back to
 * the kit in KIT-PENDING-clock-time-picker.md.
 *
 * How it works:
 *   - The big time at the top is the state. Its hour and minute parts are
 *     buttons that switch what the dial picks; AM and PM are a toggle.
 *   - The dial picks the hour first (1 to 12), then moves on to the
 *     minutes by itself when the pointer is released. Minutes are labelled
 *     every 5 but ANY minute (3:20, 3:22) is picked by pointing between
 *     the labels, or by dragging.
 *   - Keyboard: the dial is focused on open. Arrow up/right and down/left
 *     move the hour or minute by one (minutes: by `step`; Shift moves by
 *     5), Page Up/Down by 1 hour or 5 minutes, Space switches between hour
 *     and minute, Enter sets the time, Escape cancels (the Dialog's own).
 *   - 12-hour h:mm AM/PM throughout (section 18).
 *
 * It opens from inside other dialogs (task, meeting and reminder forms). It
 * is a Dialog of its own, so it stacks above its parent on the kit layers
 * and its Escape, backdrop and clicks never reach the parent (see the
 * propagation guards on DialogContent below). This is a recorded exception
 * to section 24 rule 4.
 */

const SIZE = 240
const C = SIZE / 2
const R = 96
const MINUTE_LABELS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
const HOUR_LABELS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const MERIDIEMS = ["AM", "PM"] as const

type Mode = "hour" | "minute"

function polar(fraction: number, radius: number): [number, number] {
  const a = fraction * 2 * Math.PI
  return [C + radius * Math.sin(a), C - radius * Math.cos(a)]
}

function wrap(n: number, size: number) {
  return ((n % size) + size) % size
}

const ringClasses =
  "outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring"

function ClockTimePicker({
  open,
  onOpenChange,
  value,
  onValueChange,
  label,
  step = 1,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: TimeValue | undefined
  onValueChange: (value: TimeValue) => void
  /** The dialog's title. Defaults to "Choose a time". */
  label?: string
  /** Minutes the dial picks to. 1 (default) gives every minute. */
  step?: number
}) {
  const [hour, setHour] = React.useState(value?.hour ?? 9)
  const [minute, setMinute] = React.useState(value?.minute ?? 0)
  const [meridiem, setMeridiem] = React.useState<(typeof MERIDIEMS)[number]>(
    value?.meridiem ?? "AM"
  )
  const [mode, setMode] = React.useState<Mode>("hour")
  const [wasOpen, setWasOpen] = React.useState(open)
  const svgRef = React.useRef<SVGSVGElement>(null)
  const dialRef = React.useRef<HTMLDivElement>(null)
  const dragging = React.useRef(false)

  // Each opening starts from the field's current value, on the hour.
  // Adjusted during render rather than in an effect, so the dialog never
  // paints one frame of the previous opening's time.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setHour(value?.hour ?? 9)
      setMinute(value?.minute ?? 0)
      setMeridiem(value?.meridiem ?? "AM")
      setMode("hour")
    }
  }

  const size = Math.max(1, Math.round(step))
  const minuteMode = mode === "minute"
  const [hx, hy] = polar(minuteMode ? minute / 60 : (hour % 12) / 12, R)
  const offLabel = minuteMode && minute % 5 !== 0

  function commit() {
    onValueChange({ hour, minute, meridiem })
    onOpenChange(false)
  }

  function pointAt(e: React.PointerEvent) {
    const rect = svgRef.current!.getBoundingClientRect()
    const x = ((e.clientX - rect.left) * SIZE) / rect.width - C
    const y = ((e.clientY - rect.top) * SIZE) / rect.height - C
    const fraction = (Math.atan2(x, -y) / (2 * Math.PI) + 1) % 1
    if (minuteMode) {
      const raw = Math.round(fraction * 60) % 60
      setMinute(size > 1 ? (Math.round(raw / size) * size) % 60 : raw)
    } else {
      setHour(Math.round(fraction * 12) % 12 || 12)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const forward = e.key === "ArrowUp" || e.key === "ArrowRight"
    const back = e.key === "ArrowDown" || e.key === "ArrowLeft"
    if (forward || back || e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault()
      e.stopPropagation()
      const sign = forward || e.key === "PageUp" ? 1 : -1
      if (minuteMode) {
        const by = e.shiftKey || e.key.startsWith("Page") ? 5 : size
        setMinute((m) => wrap(m + sign * by, 60))
      } else {
        setHour((h) => wrap(h - 1 + sign, 12) + 1)
      }
    } else if (e.key === " ") {
      e.preventDefault()
      e.stopPropagation()
      setMode(minuteMode ? "hour" : "minute")
    } else if (e.key === "Enter") {
      e.preventDefault()
      e.stopPropagation()
      commit()
    }
  }

  const partClasses = (active: boolean) =>
    cn(
      "tap-area h-control-lg min-w-16 cursor-pointer rounded-lg px-3 text-center text-page-title tabular-nums",
      "transition-[background-color,color] duration-(--duration-fast)",
      ringClasses,
      active
        ? "bg-primary-subtle text-primary-text"
        : "bg-surface-control text-text-primary hover:bg-surface-control-pressed"
    )


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        // This dialog opens from inside other dialogs. React events from
        // a portal bubble through the React tree to the form beneath, so
        // keys and clicks are stopped here: an Enter must not submit the
        // parent form, a click must not reach a clickable row behind it.
        // Escape is Base UI's own document listener and is unaffected.
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        initialFocus={dialRef}
      >
        <DialogHeader>
          <DialogTitle>{label || "Choose a time"}</DialogTitle>
        </DialogHeader>
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={!minuteMode}
            aria-label={`Hour, ${hour}`}
            onClick={() => setMode("hour")}
            className={partClasses(!minuteMode)}
          >
            {hour}
          </button>
          <span aria-hidden className="text-page-title text-text-muted">
            :
          </span>
          <button
            type="button"
            aria-pressed={minuteMode}
            aria-label={`Minute, ${String(minute).padStart(2, "0")}`}
            onClick={() => setMode("minute")}
            className={partClasses(minuteMode)}
          >
            {String(minute).padStart(2, "0")}
          </button>
          <ToggleGroup
            aria-label="AM or PM"
            value={[meridiem]}
            // Single choice: pressing the side already chosen would empty it.
            onValueChange={(next) => {
              const picked = next[0] as (typeof MERIDIEMS)[number] | undefined
              if (picked) setMeridiem(picked)
            }}
            className="ml-2 inline-flex h-control-lg flex-col overflow-hidden rounded-lg border border-border bg-surface"
          >
            {MERIDIEMS.map((m) => (
              <Toggle
                key={m}
                value={m}
                className={cn(
                  "tap-area flex flex-1 cursor-pointer items-center justify-center px-3 text-label text-text-secondary",
                  "transition-[background-color,color] duration-(--duration-fast)",
                  "not-first:border-t not-first:border-border",
                  "not-data-pressed:hover:bg-surface-control not-data-pressed:hover:text-text-primary not-data-pressed:active:bg-surface-control-pressed",
                  "data-pressed:cursor-default data-pressed:bg-primary-subtle data-pressed:text-primary-text",
                  "outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-primary-ring"
                )}
              >
                {m}
              </Toggle>
            ))}
          </ToggleGroup>
        </div>

        <p className="text-meta text-text-muted">
          {minuteMode ? "Point at the minute" : "Point at the hour"}
        </p>

        <div
          ref={dialRef}
          data-slot="clock-dial"
          role="slider"
          tabIndex={0}
          aria-label={minuteMode ? "Minute" : "Hour"}
          aria-orientation="horizontal"
          aria-valuemin={minuteMode ? 0 : 1}
          aria-valuemax={minuteMode ? 59 : 12}
          aria-valuenow={minuteMode ? minute : hour}
          aria-valuetext={`${hour}:${String(minute).padStart(2, "0")} ${meridiem}`}
          onKeyDown={onKeyDown}
          className={cn("w-4/5 rounded-full", ringClasses)}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="block w-full cursor-pointer touch-none select-none"
            aria-hidden
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              dragging.current = true
              pointAt(e)
            }}
            onPointerMove={(e) => {
              if (dragging.current) pointAt(e)
            }}
            onPointerUp={(e) => {
              if (!dragging.current) return
              dragging.current = false
              pointAt(e)
              // The hour is chosen: go on to the minutes.
              if (!minuteMode) setMode("minute")
            }}
            onPointerCancel={() => {
              dragging.current = false
            }}
          >
            <circle cx={C} cy={C} r={C - 1} className="fill-surface-control" />

            {minuteMode &&
              Array.from({ length: 60 }, (_, i) => i)
                .filter((i) => i % 5 !== 0)
                .map((i) => {
                  const [x, y] = polar(i / 60, R)
                  return <circle key={i} cx={x} cy={y} r={1.5} className="fill-border" />
                })}

            <line
              x1={C}
              y1={C}
              x2={hx}
              y2={hy}
              strokeWidth={2}
              strokeLinecap="round"
              className="stroke-primary"
            />
            <circle cx={C} cy={C} r={4} className="fill-primary" />
            <circle cx={hx} cy={hy} r={18} className="fill-primary" />
            {offLabel && <circle cx={hx} cy={hy} r={5} className="fill-primary-foreground" />}

            {(minuteMode ? MINUTE_LABELS : HOUR_LABELS).map((n, i) => {
              const [x, y] = polar(i / 12, R)
              const selected = minuteMode ? minute === n : hour === n
              return (
                <text
                  key={n}
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={cn(
                    "pointer-events-none text-label tabular-nums",
                    selected ? "fill-primary-foreground" : "fill-text-primary"
                  )}
                >
                  {minuteMode ? String(n).padStart(2, "0") : n}
                </text>
              )
            })}
          </svg>
        </div>
      </div>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="secondary" />}>
            Cancel
          </DialogClose>
          <Button type="button" onClick={commit}>
            Set time
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ClockTimePicker }
