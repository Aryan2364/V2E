/**
 * Section 18 (and 18.1, 20.1, 37.5): the one implementation of every date,
 * time, number, amount and relative-time format in the kit (section 4 rule
 * 2). Nothing else in the product formats a date or an amount by hand.
 *
 * SERVER AND CLIENT MUST PRINT THE SAME TEXT, or React's hydration fails.
 * A date or amount is never formatted from the machine's own clock or
 * locale: everything below is computed from explicit settings (TIME_ZONE,
 * the month names, the currency symbol), so a server running in UTC and a
 * browser running in any time zone produce identical strings. See
 * node_modules/next/dist/docs on server/client components: any value that
 * differs between the server render and the first client render throws a
 * hydration mismatch, so no formatter here may read Date.prototype's local
 * getters (getHours, getDate, ...) or the runtime's default locale.
 *
 * ---- Product settings (section 0.1 item 6: section 18 is regional) ----
 * A new product edits this block, not the functions below.
 */

/** Every date and time in the product renders in this zone, never the machine's own. */
const TIME_ZONE = "Asia/Kolkata"

/**
 * The product's language (section 37.6). English month names, full and
 * short. A product in another language replaces both arrays; digits stay
 * 0 to 9 regardless (37.6 rule 5).
 */
const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const

const MONTH_NAMES_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const

/** Section 18's currency symbol. */
const CURRENCY_SYMBOL = "₹"

/** U+2212, a true minus sign - never a hyphen (section 18). */
const MINUS_SIGN = "−"

/* ------------------------------------------------------------------
   Reading the three kinds of input.

   A "moment" (a Date instance, or an ISO string carrying a time or a "Z"/
   offset) is a single instant in universal time. It is read in TIME_ZONE
   explicitly, with Intl's timeZone option, so the calendar date and clock
   time shown are the same on every server and every browser regardless of
   the machine's own zone.

   A "plain date" ("2026-08-12", with no time part) is a calendar date,
   not an instant, and section 18 says it is never shifted by a time zone:
   it reads back exactly the day that was typed or stored, nowhere else.
   ------------------------------------------------------------------ */

type CalendarParts = { year: number; month: number; day: number; hour: number; minute: number }

const PLAIN_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Reads any of the three accepted inputs into zone-correct calendar parts, or null. */
function readParts(value: Date | string): CalendarParts | null {
  if (typeof value === "string") {
    const plain = PLAIN_DATE_RE.exec(value.trim())
    if (plain) {
      const year = Number(plain[1])
      const month = Number(plain[2])
      const day = Number(plain[3])
      if (!isRealCalendarDate(year, month, day)) return null
      return { year, month, day, hour: 0, minute: 0 }
    }
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return partsInZone(date)
  }
  if (Number.isNaN(value.getTime())) return null
  return partsInZone(value)
}

/** A moment's calendar date and clock time in TIME_ZONE, from its UTC instant. */
function partsInZone(date: Date): CalendarParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  })
  const found: Record<string, string> = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") found[part.type] = part.value
  }
  // Intl's 24-hour "hour" can print "24" for midnight in some engines; fold it to 0.
  const hour = Number(found.hour) % 24
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    hour,
    minute: Number(found.minute),
  }
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  return day <= daysInMonth(year, month)
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/* ------------------------------------------------------------------
   Section 18: dates and times.
   ------------------------------------------------------------------ */

/** DD Mon YYYY, e.g. "12 Aug 2026". Empty string when the input cannot be read. */
function formatDate(value: Date | string): string {
  const parts = readParts(value)
  if (!parts) return ""
  return `${parts.day} ${MONTH_NAMES_SHORT[parts.month - 1]} ${parts.year}`
}

/**
 * v2e addition: the day and month of DD Mon YYYY without the year, e.g. "12 Aug",
 * for calendar strips and lists already grouped by year. Same parts as formatDate.
 */
function formatDayMonth(value: Date | string): string {
  const parts = readParts(value)
  if (!parts) return ""
  return `${parts.day} ${MONTH_NAMES_SHORT[parts.month - 1]}`
}

const WEEKDAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

/** v2e addition: short weekday of the calendar date in TIME_ZONE, e.g. "Mon". */
function formatWeekday(value: Date | string): string {
  const parts = readParts(value)
  if (!parts) return ""
  return WEEKDAY_NAMES_SHORT[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()]
}

/** h:mm A, e.g. "3:45 PM". Empty string when the input cannot be read. */
function formatTime(value: Date | string): string {
  const parts = readParts(value)
  if (!parts) return ""
  const hour12 = parts.hour % 12 || 12
  const meridiem = parts.hour < 12 ? "AM" : "PM"
  return `${hour12}:${pad2(parts.minute)} ${meridiem}`
}

/** DD Mon YYYY, h:mm A, e.g. "12 Aug 2026, 3:45 PM". Empty string when unreadable. */
function formatDateTime(value: Date | string): string {
  const parts = readParts(value)
  if (!parts) return ""
  return `${formatDate(value)}, ${formatTime(value)}`
}

/* ------------------------------------------------------------------
   Section 20.1: typed-entry parsing of DD Mon YYYY.
   ------------------------------------------------------------------ */

/**
 * Reads a typed DD Mon YYYY entry back into a Date at local midnight (the
 * same shape react-day-picker and the calendar popover already use), or
 * null when the text is not a real date (20.1: the field keeps what was
 * typed and shows the inline error).
 *
 * Accepted variants, so ordinary typing is never rejected on a technicality:
 *   - 1 or 2 digit day ("2" or "02")
 *   - the month as its short form ("Aug") or its full name ("August"),
 *     in any case ("aug", "AUG", "August")
 *   - a 4-digit year
 *   - any amount of single spaces between the three parts
 * The day must be a real day of that month (parseDate("31 Feb 2026") is
 * null, not snapped to the nearest valid day).
 */
function parseDate(text: string): Date | null {
  const match = /^\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*$/.exec(text)
  if (!match) return null
  const day = Number(match[1])
  const monthWord = match[2].toLowerCase()
  const year = Number(match[3])
  const month = monthFromWord(monthWord)
  if (month === null) return null
  if (!isRealCalendarDate(year, month, day)) return null
  return new Date(year, month - 1, day)
}

function monthFromWord(word: string): number | null {
  const short = MONTH_NAMES_SHORT.findIndex((m) => m.toLowerCase() === word)
  if (short !== -1) return short + 1
  const full = MONTH_NAMES_FULL.findIndex((m) => m.toLowerCase() === word)
  if (full !== -1) return full + 1
  return null
}

/* ------------------------------------------------------------------
   Section 18: numbers, amounts and currency.
   ------------------------------------------------------------------ */

/**
 * Indian digit grouping, by arithmetic rather than Intl: the last three
 * digits, then groups of two ("12,45,680"). en-IN's grouping is reliable
 * in both Node and every shipped browser, but the rounding and the
 * negative/decimal handling below are simpler to get exactly right, and
 * exactly matching on server and client, by doing the grouping ourselves
 * than by trusting Intl.NumberFormat's rounding mode across engines.
 */
function groupIndianDigits(digits: string): string {
  if (digits.length <= 3) return digits
  const last3 = digits.slice(-3)
  let rest = digits.slice(0, -3)
  const groups: string[] = []
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2))
    rest = rest.slice(0, -2)
  }
  if (rest.length > 0) groups.unshift(rest)
  return `${groups.join(",")},${last3}`
}

/** A non-negative integer's magnitude, grouped: formatNumber(-5) -> "5" (sign handled by callers). */
function groupedInteger(magnitude: number): string {
  return groupIndianDigits(String(Math.round(magnitude)))
}

/** Indian grouping, no decimals: formatNumber(1245680) -> "12,45,680". */
function formatNumber(n: number): string {
  const sign = n < 0 ? MINUS_SIGN : ""
  return `${sign}${groupedInteger(Math.abs(n))}`
}

/** Two decimals always, Indian grouping: formatAmount(4200) -> "4,200.00". */
function formatAmount(n: number): string {
  const sign = n < 0 ? MINUS_SIGN : ""
  const fixed = Math.abs(n).toFixed(2)
  const [whole, decimals] = fixed.split(".")
  return `${sign}${groupIndianDigits(whole)}.${decimals}`
}

/**
 * Symbol before, no gap, two decimals, Indian grouping, a true minus sign
 * before the symbol for a negative amount: "₹4,200.00", "−₹4,200.00".
 */
function formatCurrency(n: number): string {
  const sign = n < 0 ? MINUS_SIGN : ""
  const fixed = Math.abs(n).toFixed(2)
  const [whole, decimals] = fixed.split(".")
  return `${sign}${CURRENCY_SYMBOL}${groupIndianDigits(whole)}.${decimals}`
}

/* ------------------------------------------------------------------
   Section 18.1: short amounts and counts, for dashboard tiles and chart
   labels only (rule 4). Round to two decimals FIRST, then choose the
   unit, so 99,99,999 rounds to 100.00 L and is shown as 1.00 Cr.
   ------------------------------------------------------------------ */

const LAKH = 1_00_000
const CRORE = 1_00_00_000

/** Rounds to two decimals, then strips a trailing ".00" only when the value is a whole number display. */
function twoDecimals(n: number): string {
  return n.toFixed(2)
}

function shortMagnitude(magnitude: number): string {
  if (magnitude < LAKH) return `${CURRENCY_SYMBOL}${groupedInteger(magnitude)}`
  const roundedLakh = Math.round((magnitude / LAKH) * 100) / 100
  if (roundedLakh < 100) return `${twoDecimals(roundedLakh)} L`
  const roundedCrore = Math.round((magnitude / CRORE) * 100) / 100
  return `${twoDecimals(roundedCrore)} Cr`
}

/**
 * Section 18.1: ₹98,500 below 1 lakh, "₹12.46 L" from 1 lakh to below 1
 * crore, "₹12.46 Cr" at 1 crore and up. A space sits before L or Cr. The
 * sign is a true minus before the symbol: formatShortAmount(-1246000) ->
 * "−₹12.46 L". Dashboard tiles and chart labels only (18.1 rule 4);
 * tables, forms, detail pages and reports show the full amount.
 */
function formatShortAmount(n: number): string {
  const sign = n < 0 ? MINUS_SIGN : ""
  const body = shortMagnitude(Math.abs(n))
  return body.startsWith(CURRENCY_SYMBOL)
    ? `${sign}${body}`
    : `${sign}${CURRENCY_SYMBOL}${body}`
}

/** The same table as formatShortAmount, without the ₹ (18.1 rule 3): large counts on tiles. */
function formatShortCount(n: number): string {
  const sign = n < 0 ? MINUS_SIGN : ""
  const magnitude = Math.abs(n)
  if (magnitude < LAKH) return `${sign}${groupedInteger(magnitude)}`
  const roundedLakh = Math.round((magnitude / LAKH) * 100) / 100
  if (roundedLakh < 100) return `${sign}${twoDecimals(roundedLakh)} L`
  const roundedCrore = Math.round((magnitude / CRORE) * 100) / 100
  return `${sign}${twoDecimals(roundedCrore)} Cr`
}

/* ------------------------------------------------------------------
   37.5: a count with the right singular or plural noun: "1 task",
   "2 tasks". Indian grouping applies to the number too.
   ------------------------------------------------------------------ */

/**
 * formatCount(1, { one: "task", many: "tasks" }) -> "1 task"
 * formatCount(2, { one: "task", many: "tasks" }) -> "2 tasks"
 */
function formatCount(n: number, noun: { one: string; many: string }): string {
  return `${formatNumber(n)} ${n === 1 ? noun.one : noun.many}`
}

/* ------------------------------------------------------------------
   Relative time, for activity feeds and notifications ONLY (section 18:
   "'2 hours ago' style is allowed in activity feeds and notifications
   only. Everywhere else uses the full date."). Falls back to formatDate
   past a week, since "9 days ago" stops being a useful unit of time.
   ------------------------------------------------------------------ */

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const RELATIVE_FALLBACK_MS = 7 * DAY_MS

/**
 * "just now" (under a minute), "N minute(s) ago" (under an hour), "N
 * hour(s) ago" (under a day), "Yesterday" (1 to under 2 days ago, same
 * wording regardless of the hour), "N days ago" (2 to under 7 days ago),
 * then formatDate for anything older or in the future. `now` defaults to
 * the current moment; a caller passing it explicitly gets a result that
 * does not depend on when it happens to render (needed for server/client
 * parity: pass the same `now` on both sides, computed once per request).
 */
function formatRelative(value: Date | string, now: Date | string = new Date()): string {
  const then = toInstant(value)
  const at = toInstant(now)
  if (then === null || at === null) return ""
  const diff = at - then
  if (diff < 0 || diff >= RELATIVE_FALLBACK_MS) return formatDate(value)

  if (diff < MINUTE_MS) return "just now"
  if (diff < HOUR_MS) {
    const minutes = Math.floor(diff / MINUTE_MS)
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  }
  if (diff < DAY_MS) {
    const hours = Math.floor(diff / HOUR_MS)
    return `${hours} hour${hours === 1 ? "" : "s"} ago`
  }
  const days = Math.floor(diff / DAY_MS)
  if (days === 1) return "Yesterday"
  return `${days} days ago`
}

/**
 * The label of a day divider in a comment thread (section 18): "Today",
 * "Yesterday", then the full date, DD Mon YYYY. Days are counted in
 * TIME_ZONE, so the divider changes at the product's midnight, not the
 * viewer's. A day in the future reads as its full date. Allowed in a
 * thread only, like formatRelative's feeds.
 */
function formatDay(value: Date | string, now: Date | string = new Date()): string {
  const then = readParts(value)
  const at = toInstant(now)
  if (then === null || at === null) return ""
  const same = (a: CalendarParts, b: CalendarParts) => a.year === b.year && a.month === b.month && a.day === b.day
  if (same(then, partsInZone(new Date(at)))) return "Today"
  if (same(then, partsInZone(new Date(at - DAY_MS)))) return "Yesterday"
  return formatDate(value)
}

function toInstant(value: Date | string): number | null {
  if (typeof value === "string") {
    const plain = PLAIN_DATE_RE.exec(value.trim())
    if (plain) {
      const parts = readParts(value)
      if (!parts) return null
      // Midnight of that calendar date, in TIME_ZONE, as a real instant.
      return zonedMidnightInstant(parts.year, parts.month, parts.day)
    }
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.getTime()
  }
  return Number.isNaN(value.getTime()) ? null : value.getTime()
}

/** The UTC instant of midnight on a given TIME_ZONE calendar date, by search (TIME_ZONE has no half-hour DST, so this is exact). */
function zonedMidnightInstant(year: number, month: number, day: number): number {
  const guessUtc = Date.UTC(year, month - 1, day)
  const guessParts = partsInZone(new Date(guessUtc))
  const guessAsUtc = Date.UTC(guessParts.year, guessParts.month - 1, guessParts.day, guessParts.hour, guessParts.minute)
  return guessUtc - (guessAsUtc - guessUtc)
}

export {
  TIME_ZONE,
  formatDate,
  formatDayMonth,
  formatWeekday,
  formatTime,
  formatDateTime,
  parseDate,
  formatNumber,
  formatAmount,
  formatCurrency,
  formatShortAmount,
  formatShortCount,
  formatCount,
  formatRelative,
  formatDay,
}
