"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import {
  CheckIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  DownloadIcon,
  EllipsisIcon,
  EyeIcon,
  FunnelIcon,
  IndianRupeeIcon,
  OctagonXIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge, Count, STATUS_ICON } from "@/components/ui/badge"
import { InlineChoice } from "@/components/ui/inline-choice"
import {
  Board,
  useBoardAvailable,
  type BoardCard as BoardCardModel,
} from "@/components/ui/board"
import {
  Banner,
  BannerAction,
  BannerClose,
  BannerDescription,
  BannerTitle,
  useBannerDismissal,
} from "@/components/ui/banner"
import { CommentBox } from "@/components/ui/comment-box"
import { CommentThread, type ThreadItem } from "@/components/ui/comment-thread"
import { CategoryBarChart } from "@/components/ui/bar-chart"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardLink,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Clamp, Truncate } from "@/components/ui/truncate"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/ui/empty-state"
import { InlineFieldError } from "@/components/ui/inline-field-error"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import {
  Pagination,
  PaginationBar,
  PaginationContent,
  PaginationCount,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { OtpField } from "@/components/ui/otp-field"
import { PasswordInput } from "@/components/ui/password-input"
import { PermissionTooltip } from "@/components/ui/permission-tooltip"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverFooter,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MultiSelect } from "@/components/ui/multi-select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { SectionTabs } from "@/components/ui/section-tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { StateMatrixCheck } from "@/components/ui/state-matrix-check"
import { toast } from "@/components/ui/sonner"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRowHeader,
  TableRowLink,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { TimePicker, type TimeValue } from "@/components/ui/time-picker"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { TextLink } from "@/components/ui/text-link"
import { isChanged, useUnsavedChanges } from "@/components/ui/unsaved-changes"
import {
  KeyboardShortcuts,
  useKeyboardShortcuts,
  ctrlEnterSaves,
} from "@/components/ui/keyboard-shortcuts"
import { useListView, ViewSwitcher } from "@/components/ui/view-switcher"
import { useKeyboard } from "@/lib/keyboard"
import { useLayout } from "@/lib/layout"
import { ChoiceRow } from "@/components/ui/choice-row"
import { RepeatingRows } from "@/components/ui/repeating-rows"
import { cn } from "@/lib/utils"

/* -------------------------------------------------------------------
   Page scaffolding local to this reference page. Nothing here is a
   product component; product screens use the section 11 templates.
   ------------------------------------------------------------------- */

function Section({
  n,
  title,
  note,
  children,
}: {
  n: string
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-12 first:mt-0">
      <h2 className="text-section font-medium text-text-primary">
        <span className="text-text-muted">{n}. </span>
        {title}
      </h2>
      {note ? (
        <p className="mt-2 max-w-[70ch] text-body text-text-secondary">{note}</p>
      ) : null}
      <div className="mt-6">{children}</div>
    </section>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>
}

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-meta text-text-muted">{children}</p>
}

/**
 * One column of the state matrix. `force` replays hover, pressed and
 * focus through the [data-force] rules in globals.css, so all four
 * states plus the focus ring are visible at once without a pointer or
 * the keyboard being on any of them.
 */
function StateCell({
  state,
  children,
}: {
  state: "resting" | "hover" | "pressed" | "disabled" | "focus"
  children: React.ReactNode
}) {
  const forced = state === "hover" || state === "pressed" || state === "focus"
  return (
    <div className="flex flex-col gap-2">
      <p className="text-meta text-text-muted">{state}</p>
      <div data-force={forced ? state : undefined}>{children}</div>
    </div>
  )
}

const STATES = ["resting", "hover", "pressed", "disabled", "focus"] as const

/**
 * `states` narrows the columns to the ones a control actually has.
 *
 * Section 6.4: a text-entry control is not pressed, it is focused, so
 * an input has no hover fill and no pressed fill to show. Rendering it
 * in those two columns would print its resting appearance under the
 * word "hover" — which is the exact lie this matrix exists to catch,
 * committed by the matrix itself.
 *
 * Leaving the columns out is also what keeps `state-matrix-check`
 * honest: it compares elements inside a `[data-force]` cell against
 * their resting twin, so a column that is never rendered has nothing
 * to report rather than a false alarm to suppress.
 */
function StateMatrix({
  label,
  render,
  states = STATES,
  note,
}: {
  label: string
  render: (state: (typeof STATES)[number]) => React.ReactNode
  states?: readonly (typeof STATES)[number][]
  note?: string
}) {
  return (
    <div className="border-b border-border-light py-4 last:border-b-0">
      <p className="text-label text-text-secondary">{label}</p>
      {note ? <p className="mt-1 text-meta text-text-muted">{note}</p> : null}
      <div className="mt-3 flex flex-wrap items-start gap-8">
        {states.map((s) => (
          <StateCell key={s} state={s}>
            {render(s)}
          </StateCell>
        ))}
      </div>
    </div>
  )
}

/** Section 6.4: the columns a text-entry control actually has. */
const TEXT_ENTRY_STATES = ["resting", "hover", "disabled", "focus"] as const

/**
 * Section 33, shown the way it is actually used: the tab bar reads the
 * active view out of the URL rather than holding it in state.
 */
function SectionTabsDemo() {
  const searchParams = useSearchParams()
  const view = searchParams.get("view") ?? "summary"

  return (
    <>
      <SectionTabs
        value={view}
        tabs={[
          { value: "summary", label: "Summary" },
          { value: "by-region", label: "By region" },
          { value: "by-month", label: "By month" },
        ]}
      />
      <p className="mt-4 text-body text-text-secondary">
        Showing the {view.replace("-", " ")} view. The toolbar&rsquo;s own state
        belongs to its tab: search, filters and sort do not carry across,
        because they filter different columns on each.
      </p>
    </>
  )
}

const COLOUR_GROUPS: {
  group: string
  tokens: { name: string; className: string; on?: "brand" | "fixed" }[]
}[] = [
  {
    group: "Brand",
    tokens: [
      { name: "primary", className: "bg-primary", on: "brand" },
      { name: "primary-hover", className: "bg-primary-hover", on: "brand" },
      { name: "primary-pressed", className: "bg-primary-pressed", on: "brand" },
      { name: "primary-ring", className: "bg-primary-ring", on: "brand" },
      { name: "primary-subtle", className: "bg-primary-subtle" },
      { name: "primary-border", className: "bg-primary-border" },
    ],
  },
  {
    group: "Surfaces and lines",
    tokens: [
      { name: "surface", className: "bg-surface" },
      { name: "surface-sunken", className: "bg-surface-sunken" },
      { name: "surface-control", className: "bg-surface-control" },
      { name: "border", className: "bg-border" },
      { name: "border-light", className: "bg-border-light" },
      { name: "border-strong", className: "bg-border-strong" },
    ],
  },
  {
    group: "Status",
    tokens: [
      { name: "success", className: "bg-success", on: "fixed" },
      { name: "success-bg", className: "bg-success-bg" },
      { name: "warning", className: "bg-warning", on: "fixed" },
      { name: "warning-bg", className: "bg-warning-bg" },
      { name: "danger", className: "bg-danger", on: "fixed" },
      { name: "danger-bg", className: "bg-danger-bg" },
    ],
  },
  {
    group: "Charts",
    tokens: [
      { name: "chart-1", className: "bg-chart-1", on: "brand" },
      { name: "chart-2", className: "bg-chart-2" },
      { name: "chart-3", className: "bg-chart-3", on: "fixed" },
      { name: "chart-4", className: "bg-chart-4", on: "fixed" },
      { name: "chart-5", className: "bg-chart-5" },
      { name: "chart-6", className: "bg-chart-6", on: "fixed" },
    ],
  },
]

const TYPE_SLOTS = [
  { slot: "Page title", className: "text-page-title font-medium text-text-primary" },
  { slot: "Section heading", className: "text-section font-medium text-text-primary" },
  { slot: "Card heading", className: "text-card-heading font-medium text-text-primary" },
  { slot: "Body", className: "text-body text-text-primary" },
  { slot: "Body strong", className: "text-body font-medium text-text-primary" },
  { slot: "Label", className: "text-label text-text-secondary" },
  { slot: "Meta", className: "text-meta text-text-muted" },
]

const SPACING_STEPS = [
  { token: "space-1", className: "w-1" },
  { token: "space-2", className: "w-2" },
  { token: "space-3", className: "w-3" },
  { token: "space-4", className: "w-4" },
  { token: "space-6", className: "w-6" },
  { token: "space-8", className: "w-8" },
  { token: "space-12", className: "w-12" },
]

/** Drives the section 22 radio menu below; a radio group needs a value. */
const SORT_KEYS = {
  name: "Name",
  added: "Date added",
  value: "Order value",
}

const REGIONS = {
  north: "North",
  south: "South",
  east: "East",
  west: "West",
}

/** Sixteen, to exercise the section 16.2 scroll cap and the 16.3 search box. */
const CATEGORIES = {
  adhesives: "Adhesives",
  bearings: "Bearings",
  belts: "Belts",
  cables: "Cables",
  castings: "Castings",
  connectors: "Connectors",
  fasteners: "Fasteners",
  filters: "Filters",
  gaskets: "Gaskets",
  hoses: "Hoses",
  lubricants: "Lubricants",
  motors: "Motors",
  pumps: "Pumps",
  seals: "Seals",
  valves: "Valves",
  washers: "Washers",
}

/** Section 40.6 rule 9: job roles first, then the "+" add-on roles. */
const ROLES = {
  accountant: "Office accountant",
  manager: "Branch manager",
  approver: "+ Invoice approver",
  access: "+ Access manager",
}

/** Section 40.11: the last person who can manage access keeps that role. */
const LOCKED_ROLES = {
  access: "Rakesh Mehta is the only person who can manage access. Give that to someone else first.",
}

/**
 * Eight rows, so the 256px scroll box actually scrolls and the sticky
 * header has something to stay put against. Amounts run to lakh scale so
 * the section 18 digit grouping is visible; statuses cover all three.
 */
const ORDERS = [
  { customer: "Halcyon Supplies", order: "ORD-0148", date: "12 Aug 2026", units: "1,240", amount: "12,45,680.00", status: "success" as const },
  { customer: "Meridian Traders", order: "ORD-0147", date: "09 Aug 2026", units: "320", amount: "3,27,900.00", status: "warning" as const },
  { customer: "Northwind Components", order: "ORD-0146", date: "04 Aug 2026", units: "860", amount: "8,60,000.00", status: "danger" as const },
  { customer: "Ardent Industrial", order: "ORD-0145", date: "28 Jul 2026", units: "185", amount: "1,84,500.00", status: "success" as const },
  { customer: "Blue Harbour Logistics", order: "ORD-0144", date: "21 Jul 2026", units: "215", amount: "2,15,750.00", status: "warning" as const },
  { customer: "Cobalt Manufacturing", order: "ORD-0143", date: "14 Jul 2026", units: "96", amount: "96,400.00", status: "success" as const },
  { customer: "Delta Fabrication", order: "ORD-0142", date: "02 Jul 2026", units: "74", amount: "74,300.00", status: "danger" as const },
  { customer: "Evergreen Distributors", order: "ORD-0141", date: "26 Jun 2026", units: "45", amount: "45,200.00", status: "success" as const },
]

const LONG_CUSTOMER_NAME =
  "Northwind Components and Industrial Supplies Private Limited"

/* Section 34. TWELVE columns on purpose: 240px of frozen first column
   plus 12 x 120px is 1680px, which overflows the content area on a
   desktop as well as a laptop. A frozen first column proves nothing in
   a table that fits, and a demo that fits is how the trap below gets
   shipped — the same grid was reachable on a list page and clipped on a
   detail page, because Card is overflow-hidden and the list page's data
   area is not. A scrolling table needs a host that can scroll. */
const REPORT_MONTHS = [
  "Apr", "May", "Jun", "Jul", "Aug", "Sep",
  "Oct", "Nov", "Dec", "Jan", "Feb", "Mar",
]

const REPORT_ROWS = [
  { region: "North", values: ["4,12,000.00", "3,88,500.00", "4,40,100.00", "4,02,600.00", "4,61,900.00", "4,18,200.00", "3,96,400.00", "4,55,000.00", "4,30,800.00", "4,07,200.00", "4,49,600.00", "4,71,300.00"] },
  { region: "South", values: ["2,84,300.00", "3,01,700.00", "2,96,800.00", "3,15,400.00", "3,28,900.00", "3,04,100.00", "2,91,600.00", "3,22,700.00", "3,10,500.00", "2,98,300.00", "3,19,800.00", "3,34,200.00"] },
  { region: "East", values: ["1,62,400.00", "1,70,900.00", "1,58,200.00", "1,74,600.00", "1,81,300.00", "1,66,700.00", "1,59,800.00", "1,77,200.00", "1,68,900.00", "1,61,500.00", "1,73,400.00", "1,85,100.00"] },
  { region: "West", values: ["3,45,100.00", "3,62,800.00", "3,51,400.00", "3,70,200.00", "3,84,600.00", "3,58,900.00", "3,41,700.00", "3,79,500.00", "3,66,200.00", "3,49,800.00", "3,74,100.00", "3,91,600.00"] },
]

/* Section 21. The value is the bar's length and is a number because a
   pixel measurement cannot be anything else; the text beside it is
   formatted by the caller, so the digits a person reads never went
   through a float. */
const CHART_ROWS = [
  { region: "North", planned: 4800000, plannedText: "48,00,000.00", actual: 5217600, actualText: "52,17,600.00" },
  { region: "South", planned: 3600000, plannedText: "36,00,000.00", actual: 3348900, actualText: "33,48,900.00" },
  { region: "East", planned: 2100000, plannedText: "21,00,000.00", actual: 1908400, actualText: "19,08,400.00" },
  { region: "West", planned: 4200000, plannedText: "42,00,000.00", actual: 4463200, actualText: "44,63,200.00" },
]

const REPORT_TOTALS = [
  "12,03,800.00", "12,23,900.00", "12,46,500.00", "12,62,800.00",
  "13,56,700.00", "12,47,900.00", "11,89,500.00", "13,34,400.00",
  "12,76,400.00", "12,16,800.00", "13,16,900.00", "13,82,200.00",
]

/* Section 35. Four columns of a dispatch pipeline.
   The totals are the TRUE counts under the current filters, which is
   why "Packed" reads 31 while the column renders 25 and offers Load
   more — a column header that counted what it had rendered would agree
   with itself and tell the user nothing. */
const BOARD_COLUMNS = [
  { id: "new", label: "New", total: 3 },
  { id: "packed", label: "Packed", total: 31 },
  { id: "dispatched", label: "Dispatched", total: 2 },
  { id: "delivered", label: "Delivered", total: 0 },
]

/* Section 7.2 rule 1: a status carries its icon as well as its colour,
   from the one map of role to icon. */
const SuccessIcon = STATUS_ICON.success
const WarningIcon = STATUS_ICON.warning

const BOARD_CARDS: BoardCardModel[] = [
  {
    id: "ORD-0148",
    columnId: "new",
    title: "Halcyon Supplies",
    facts: ["ORD-0148", "₹12,45,680.00"],
    meta: "12 Aug 2026",
    badge: (
      <Badge variant="warning">
        <WarningIcon />
        Payment pending
      </Badge>
    ),
  },
  {
    id: "ORD-0147",
    columnId: "new",
    title: LONG_CUSTOMER_NAME,
    facts: ["ORD-0147", "₹3,27,900.00"],
    meta: "09 Aug 2026",
  },
  {
    id: "ORD-0142",
    columnId: "new",
    title: "Delta Fabrication",
    facts: ["ORD-0142", "₹74,300.00"],
    meta: "02 Jul 2026",
    badge: (
      <Badge variant="success">
        <SuccessIcon />
        Paid
      </Badge>
    ),
  },
  {
    id: "ORD-0146",
    columnId: "dispatched",
    title: "Northwind Components",
    facts: ["ORD-0146", "₹8,60,000.00"],
    meta: "04 Aug 2026",
    badge: (
      <Badge variant="success">
        <SuccessIcon />
        Paid
      </Badge>
    ),
  },
  {
    id: "ORD-0145",
    columnId: "dispatched",
    title: "Ardent Industrial",
    facts: ["ORD-0145", "₹1,84,500.00"],
    meta: "28 Jul 2026",
    // Section 26: disabled with its reason, and the reason names who
    // may do it rather than telling the user they may not.
    moveDisabledReason: "Only people allowed to move dispatched orders can do this",
  },
  // Thirty-one in one column, on purpose: the 25 cap and Load more
  // prove nothing in a column that fits inside them.
  ...Array.from({ length: 31 }, (_, i) => ({
    id: `ORD-0${100 + i}`,
    columnId: "packed",
    title: `${["Meridian Traders", "Cobalt Manufacturing", "Blue Harbour Logistics", "Evergreen Distributors"][i % 4]}`,
    facts: [`ORD-0${100 + i}`, "₹96,400.00"] as [React.ReactNode, React.ReactNode],
    meta: "14 Jul 2026",
  })),
]

/* The one card whose save fails, so the revert and the error toast are
   visible on this page rather than only described in FRONTEND_RULES.md. Section
   35.6: a card never sits in a column the server did not agree to. */
const BOARD_FAILING_CARD = "ORD-0142"

export default function KitchenSinkPage() {
  const [date, setDate] = React.useState<Date | undefined>(
    new Date(2026, 7, 12)
  )
  const [dateError, setDateError] = React.useState<string | null>(null)
  const [time, setTime] = React.useState<TimeValue | undefined>({
    hour: 9,
    minute: 30,
    meridiem: "AM",
  })
  const [category, setCategory] = React.useState<string | undefined>("gaskets")
  const [roles, setRoles] = React.useState<string[]>(["accountant", "access"])
  const [sortKey, setSortKey] = React.useState<string>("name")
  // Section 35.3. Hoisted rather than called inside the JSX below so
  // the hook sits where every other one does.
  const boardAvailable = useBoardAvailable()

  return (
    <KeyboardShortcuts search={<KitchenSearch />}>
    <main className="mx-auto w-full max-w-content-max p-6">
      <header>
        <h1 className="text-page-title font-medium text-text-primary">
          Kitchen sink
        </h1>
        <p className="mt-2 text-label text-text-secondary">
          Every primitive in every state. This page is the reference for
          what the components do, not a product screen.
        </p>
      </header>

      <div className="mt-12">
        {/* ---------------------------------------------------------- */}
        <Section
          n="1"
          title="Colour tokens"
          note="Named by job, never by value. Every one resolves to a variable in globals.css, which is the only file that contains a colour. Change the brand there and this whole page follows."
        >
          <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {COLOUR_GROUPS.map((g) => (
              <div key={g.group}>
                <p className="text-label text-text-secondary">{g.group}</p>
                <div className="mt-3 overflow-hidden rounded-xl border border-border-light">
                  {g.tokens.map((t) => (
                    <div
                      key={t.name}
                      className={`flex h-9 items-center px-3 text-meta ${t.className} ${
                        t.on === "brand" ? "text-primary-foreground" : t.on === "fixed" ? "text-surface" : "text-text-primary"
                      }`}
                    >
                      {t.name}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Caption>
            Status colours never change when the brand colour changes. There
            is deliberately no blue information colour; neutral grey carries
            informational content.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="2"
          title="Type scale"
          note="Two weights exist, 400 and 500. If a heading is not standing out enough, add space around it rather than weight. Labels are always text-secondary; a label in text-primary reads as body text and the hierarchy collapses."
        >
          <div className="overflow-hidden rounded-xl border border-border-light bg-surface">
            {TYPE_SLOTS.map((t) => (
              <div
                key={t.slot}
                className="flex items-baseline gap-6 border-b border-border-light px-4 py-3 last:border-b-0"
              >
                <span className="w-36 shrink-0 text-meta text-text-muted">
                  {t.slot}
                </span>
                <span className={t.className}>Halcyon Supplies, order 0148</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="3"
          title="Spacing scale"
          note="Only these steps exist. There is no space-5, space-7 or space-9. If 16 feels too small and 24 too big, the answer is one of those two, never 20."
        >
          <div className="rounded-xl border border-border-light bg-surface p-4">
            {SPACING_STEPS.map((s) => (
              <div key={s.token} className="flex items-center gap-4 py-1">
                <span className="w-24 shrink-0 text-meta text-text-muted">
                  {s.token}
                </span>
                <span className={`h-3 bg-primary-subtle ${s.className}`} />
              </div>
            ))}
          </div>
          <Caption>
            Space belongs above an element, not below, so a heading stays
            attached to its own content instead of floating between two
            blocks.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="4"
          title="State matrix"
          note="Section 6.4: every interactive element defines four states, and keyboard focus shows a visible ring in primary-ring. Hover, pressed and focus are replayed here through [data-force] rules scoped to this page, so all five columns are visible at once without a pointer sitting on any of them."
        >
          <div className="rounded-xl border border-border-light bg-surface px-4">
            <StateMatrix
              label="Button, primary"
              render={(s) => <Button disabled={s === "disabled"}>Save customer</Button>}
            />
            <StateMatrix
              label="Button, secondary"
              render={(s) => (
                <Button variant="secondary" disabled={s === "disabled"}>
                  Cancel
                </Button>
              )}
            />
            <StateMatrix
              label="Button, danger"
              render={(s) => (
                <Button variant="danger" disabled={s === "disabled"}>
                  Delete customer
                </Button>
              )}
            />
            <StateMatrix
              label="Icon button, 36x36"
              render={(s) => (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Edit customer"
                  disabled={s === "disabled"}
                >
                  <PencilIcon />
                </Button>
              )}
            />
            {/* Section 6.3.1. No fill and no border at rest - the field
                around it is the container - so its states have to be
                visible on the background alone. A grey box is drawn
                behind it here only so the resting cell is not an empty
                square; the real one is the field's own border. */}
            <StateMatrix
              label="Icon button in a field"
              render={(s) => (
                <div className="inline-flex h-control items-center rounded-lg border border-border px-1">
                  <Button
                    variant="in-field"
                    size="icon-sm"
                    aria-label="Show password"
                    disabled={s === "disabled"}
                  >
                    <EyeIcon />
                  </Button>
                </div>
              )}
            />
            {/* Section 6.3.2. The band behind it is the point: with no
                fill and no border of its own, its states are only
                visible AGAINST that ground, and the focus ring has to
                reverse to on-brand because primary-ring on a primary
                ground is very nearly the ground. */}
            <StateMatrix
              label="Icon button on a band"
              render={(s) => (
                <div className="inline-flex h-control items-center rounded-lg bg-primary px-1">
                  <Button
                    variant="on-brand"
                    size="icon"
                    aria-label="Card actions"
                    disabled={s === "disabled"}
                  >
                    <EllipsisIcon />
                  </Button>
                </div>
              )}
            />
            {/* Section 35.5. The whole card is the click target (11.6),
                so the whole card carries the states - which is also why
                the check below had to be told about it: the element
                holding the states is the article, while the only
                focusable node is a button inside it with none of its
                own, and no generic selector reaches that shape. There
                is no disabled column for a card: a record is not
                disabled, and the check skips that column. */}
            <StateMatrix
              label="Board card"
              render={() => (
                <div className="h-32 w-board-column">
                  <Board
                    columns={[{ id: "new", label: "New", total: 1 }]}
                    cards={[BOARD_CARDS[0]]}
                    onOpenCard={() => {}}
                    onMove={() => {}}
                  />
                </div>
              )}
            />
            {/* Section 11.6: a record card in card view is clickable as a
                whole, so, like the board card, the card carries the states
                and the CardLink inside it carries none. Hover also lifts
                it from shadow-card to shadow-menu (5.4 rule 3). */}
            <StateMatrix
              label="Record card, clickable"
              render={() => (
                <Card variant="record" className="w-56">
                  <CardHeader>
                    <CardTitle>
                      <CardLink href="#record-card">Halcyon Supplies</CardLink>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4 text-label text-text-secondary">
                    ORD-0148
                  </CardContent>
                </Card>
              )}
            />
            {/* Section 11.1 zone 2. List is chosen here, so the card side
                carries the states; the chosen side is tinted and inert. */}
            <StateMatrix
              label="View switcher"
              render={() => <ViewSwitcher value="list" onValueChange={() => {}} />}
            />
            <StateMatrix
              label="Input"
              states={TEXT_ENTRY_STATES}
              note="Section 6.4: no pressed column. A text field is focused, not pressed, and hover moves the border only — its background is carrying text being read back and must not shift under the reader."
              render={(s) => (
                <Input
                  className="w-44"
                  defaultValue="Halcyon Supplies"
                  disabled={s === "disabled"}
                />
              )}
            />
            <StateMatrix
              label="Textarea"
              states={TEXT_ENTRY_STATES}
              note="Section 6.4, as above."
              render={(s) => (
                <Textarea
                  className="min-h-16 w-44"
                  defaultValue="Delivered short"
                  disabled={s === "disabled"}
                />
              )}
            />
            <StateMatrix
              label="Select trigger"
              render={(s) => (
                <Select defaultValue="north" items={REGIONS} disabled={s === "disabled"}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="north">North</SelectItem>
                    <SelectItem value="south">South</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            <StateMatrix
              label="Tick box"
              render={(s) => (
                <Checkbox defaultChecked disabled={s === "disabled"} aria-label="Select" />
              )}
            />
            <StateMatrix
              label="Tick box, partly ticked"
              note="Section 40.3: a tick standing for a group, some of which is ticked. Filled like ticked, with a minus."
              render={(s) => (
                <Checkbox indeterminate disabled={s === "disabled"} aria-label="Select all" />
              )}
            />
            <StateMatrix
              label="Radio"
              render={(s) => (
                <RadioGroup defaultValue="a">
                  <RadioGroupItem value="a" disabled={s === "disabled"} aria-label="Option" />
                </RadioGroup>
              )}
            />
            <StateMatrix
              label="Switch"
              render={(s) => (
                <Switch defaultChecked disabled={s === "disabled"} aria-label="Toggle" />
              )}
            />
          </div>
          {/* The matrix checking itself. Silence is the pass; anything
              whose forced state is identical to its resting state gets
              named in a danger panel here. */}
          <StateMatrixCheck />
          <Caption>
            The disabled column reduces contrast and removes the pointer
            cursor. The focus column is the ring a keyboard user sees; it is
            never removed. A state matrix can only verify what it forces, so
            the check above compares every forced cell against its resting
            twin and complains about any that are indistinguishable — a
            control rendering its resting appearance in the hover column
            looks exactly like a control that passed.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="5"
          title="Buttons in use"
          note="Exactly one primary button per screen or dialog; everything else is secondary. Ghost keeps a fill and a border, because a control the user cannot see is a control is broken."
        >
          <Row>
            <Button>
              <PlusIcon />
              New order
            </Button>
            <Button variant="secondary">
              <DownloadIcon />
              Download
            </Button>
            <Button variant="secondary">
              <FunnelIcon />
              Filter
              <Count value={2} />
            </Button>
          </Row>
          <Caption>Icons are 16px in a button and sit 4px from their label.</Caption>

          <div className="mt-6">
            <Row>
              <Button size="sm">Small, 32px</Button>
              <Button>Default, 36px</Button>
              <Button size="lg">Large, 40px</Button>
            </Row>
            <Caption>
              Height is fixed. Width grows with the label; height never does.
            </Caption>
          </div>

          <div data-ks-new className="mt-6">
            <Row>
              <Button loading={false}>Save client</Button>
              <Button loading>Save client</Button>
              <Button variant="secondary" loading loadingLabel="Signing in">
                Sign in
              </Button>
            </Row>
            <Caption>
              A button that saves is disabled while it works, reads
              &ldquo;Saving&rdquo; (or its own words) and keeps its width
              (14 rule 2). Pressed twice, it saves once.
            </Caption>
          </div>

          <div className="mt-6">
            <Row>
              <Tooltip>
                <TooltipTrigger
                  render={<Button variant="ghost" size="icon" aria-label="Edit customer" />}
                >
                  <PencilIcon />
                </TooltipTrigger>
                <TooltipContent>Edit customer</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={<Button variant="ghost" size="icon" aria-label="Search" />}
                >
                  <SearchIcon />
                </TooltipTrigger>
                <TooltipContent>Search</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={<Button variant="primary" size="icon" aria-label="Add row" />}
                >
                  <PlusIcon />
                </TooltipTrigger>
                <TooltipContent>Add row</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={<Button variant="danger" size="icon" aria-label="Delete row" />}
                >
                  <TrashIcon />
                </TooltipTrigger>
                <TooltipContent>Delete row</TooltipContent>
              </Tooltip>
            </Row>
            <Caption>
              Every icon-only button carries a hidden text label and a tooltip.
              An icon alone is a guess. Hover one to see the tooltip.
            </Caption>

            <div className="mt-6">
              <Row>
                <PermissionTooltip allowed={false} reason="Only people allowed to delete clients can do this">
                  <Button variant="danger" disabled>
                    Delete client
                  </Button>
                </PermissionTooltip>
                <PermissionTooltip allowed reason="Only people allowed to edit clients can do this">
                  <Button variant="secondary">Edit client</Button>
                </PermissionTooltip>
                <PermissionTooltip allowed={undefined} reason="Only people allowed to approve invoices can do this">
                  <Button variant="secondary" disabled>
                    Approve invoice
                  </Button>
                </PermissionTooltip>
              </Row>
              <Caption>
                Section 26. The first button is disabled, so it carries
                pointer-events-none and can never receive a hover — a tooltip
                on the button itself would be written and never readable. The
                wrapper catches the hover instead, and is focusable, because a
                keyboard user has no other route to the reason. The reason
                names the permission, never a role (26.2). The second is
                permitted and renders with no wrapper at all. The third is not
                known yet (26.1): disabled, with no wrapper and no reason,
                because a reason shown before the answer lands is a guess.
              </Caption>
              <p data-ks-new className="mt-2 text-body text-text-secondary">
                The same states from real permissions (lib/permissions.ts),
                with a switch between people:{" "}
                <TextLink href="/demo/shell/permissions" appearance="inline">
                  open the permissions demo
                </TextLink>
                .
              </p>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="6"
          title="Badges and avatars"
          note="Status is always a badge, never plain coloured text. Every status badge carries an icon as well as a colour, because colour alone is invisible to colour-blind users."
        >
          <Row>
            <Badge variant="success">
              <CheckIcon />
              Paid
            </Badge>
            <Badge variant="warning">
              <TriangleAlertIcon />
              Pending
            </Badge>
            <Badge variant="danger">
              <OctagonXIcon />
              Overdue
            </Badge>
            <Badge variant="neutral">
              <CircleDashedIcon />
              Draft
            </Badge>
          </Row>
          <Caption>
            Neutral is the default: a notification or a count is neither
            success nor failure.
          </Caption>
          <div className="mt-6">
            <Row>
              <Avatar size="sm">
                <AvatarFallback>HS</AvatarFallback>
              </Avatar>
              <Avatar>
                <AvatarFallback>MT</AvatarFallback>
              </Avatar>
              <Avatar size="lg">
                <AvatarFallback>NC</AvatarFallback>
              </Avatar>
              {/*
                AvatarImage requires an Avatar parent - it reads Avatar's
                context and throws without it. The fallback stays: it is
                what renders while the image loads and if it never does,
                which is why an avatar is never a bare img.
              */}
              <Avatar>
                <AvatarImage src="/globe.svg" alt="" />
                <AvatarFallback>IM</AvatarFallback>
              </Avatar>
            </Row>
            <Caption>
              Initials are the fallback, and the fallback is what shows while
              an image loads or when it fails. The last one carries an image;
              a product supplies real ones and keeps the initials behind them.
            </Caption>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="7"
          title="Fields"
          note="A field is as wide as the data it holds. Labels sit above the field, never beside it and never as placeholder text. Placeholder text shows an example format only."
        >
          <div className="rounded-xl border border-border-light bg-surface p-4">
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 sm:col-span-6">
                <Label htmlFor="ks-customer" required>
                  Customer name
                </Label>
                <Input
                  id="ks-customer"
                  className="mt-2"
                  defaultValue="Halcyon Supplies"
                />
              </div>
              <div className="col-span-12 sm:col-span-4">
                <Label htmlFor="ks-date">Order date</Label>
                <div className="mt-2">
                  <DatePicker id="ks-date" value={date} onValueChange={setDate} />
                </div>
              </div>
              <div className="col-span-12 sm:col-span-3">
                <Label htmlFor="ks-time">Time</Label>
                <div className="mt-2">
                  <TimePicker id="ks-time" value={time} onValueChange={setTime} />
                </div>
              </div>
              <div className="col-span-12 sm:col-span-3">
                <Label htmlFor="ks-units">Units</Label>
                <Input id="ks-units" className="mt-2 text-right" defaultValue="1,240" />
              </div>
              <div className="col-span-12 sm:col-span-3">
                <Label htmlFor="ks-amount">Amount</Label>
                <div className="mt-2">
                  <InputGroup>
                    <InputGroupAddon>
                      <IndianRupeeIcon />
                    </InputGroupAddon>
                    <InputGroupInput
                      id="ks-amount"
                      defaultValue="4,200.00"
                      className="text-right"
                    />
                  </InputGroup>
                </div>
              </div>
              <div className="col-span-12 sm:col-span-4">
                <Label htmlFor="ks-invalid">Invoice number</Label>
                <Input id="ks-invalid" className="mt-2" defaultValue="—" aria-invalid />
                <InlineFieldError>
                  Enter the invoice number printed on the invoice, like
                  INV/2026/114.
                </InlineFieldError>
              </div>
              <div className="col-span-12 sm:col-span-4">
                <Label htmlFor="ks-disabled">Region</Label>
                <Input
                  id="ks-disabled"
                  className="mt-2"
                  defaultValue="North"
                  disabled
                />
              </div>
              <div className="col-span-12 sm:col-span-6">
                <Label htmlFor="ks-password">Password</Label>
                <PasswordInput
                  id="ks-password"
                  className="mt-2"
                  defaultValue="correct horse battery staple"
                />
              </div>
              <div data-ks-new className="col-span-12">
                <OtpFieldDemo />
              </div>
              <div className="col-span-12">
                <Label htmlFor="ks-notes">Remarks</Label>
                <Textarea
                  id="ks-notes"
                  className="mt-2"
                  placeholder="Anything the next person needs to know"
                />
              </div>
              {/* Exclusive choice: arrow keys move the choice inside the
                  group (39.1). A switch is immediate, so it sits apart
                  from anything a Save would carry (section 4.1). */}
              <div className="col-span-12 sm:col-span-6">
                <p className="text-label text-text-secondary" id="ks-delivery-label">
                  Delivery
                </p>
                <RadioGroup
                  defaultValue="standard"
                  aria-labelledby="ks-delivery-label"
                  className="mt-2 flex flex-col gap-2"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="standard" id="ks-del-standard" />
                    <Label htmlFor="ks-del-standard">Standard</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="express" id="ks-del-express" />
                    <Label htmlFor="ks-del-express">Express</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="collect" id="ks-del-collect" />
                    <Label htmlFor="ks-del-collect">Collect from warehouse</Label>
                  </div>
                </RadioGroup>
              </div>
              <div className="col-span-12 sm:col-span-6">
                <div className="flex items-center gap-2">
                  <Switch id="ks-email" defaultChecked />
                  <Label htmlFor="ks-email">Email the customer when it ships</Label>
                </div>
              </div>
            </div>
          </div>
          <Caption>
            3 columns for an amount, a quantity or a time, 4 for a date or a
            short dropdown, 6 for a name, 12 for anything free-form. Error
            text states the cause, then the next action.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="8"
          title="Date and time pickers"
          note="Both accept typed entry as well as selection. Forcing someone to click through a calendar for a date they already know is slow. The week starts on Monday, today is outlined and the selected day is filled with primary. Minutes step in 15s and there are no seconds."
        >
          <div className="flex flex-wrap items-start gap-8">
            <div className="w-56">
              <Label htmlFor="ks-date-2">Date, 4 columns</Label>
              <div className="mt-2">
                <DatePicker
                  id="ks-date-2"
                  value={date}
                  onValueChange={(d) => {
                    setDate(d)
                    setDateError(null)
                  }}
                  onInvalidEntry={(typed) =>
                    setDateError(
                      `"${typed}" is not a date. Enter it as day, month and year, like 12 Aug 2026.`
                    )
                  }
                />
              </div>
              {/* Section 20.1: an entry that cannot be read keeps what was
                  typed and shows the inline error; it never snaps back. */}
              {dateError ? <InlineFieldError>{dateError}</InlineFieldError> : null}
            </div>
            <div className="w-40">
              <Label htmlFor="ks-time-2">Time, 3 columns</Label>
              <div className="mt-2">
                <TimePicker id="ks-time-2" value={time} onValueChange={setTime} />
              </div>
            </div>
            <div className="w-40">
              <Label htmlFor="ks-time-clock">Time, clock face (v2e)</Label>
              <div className="mt-2">
                <TimePicker
                  id="ks-time-clock"
                  step={1}
                  pickerVariant="clock"
                  pickerLabel="Reminder time"
                  value={time}
                  onValueChange={setTime}
                />
              </div>
            </div>
            <div>
              <p className="text-label text-text-secondary">Calendar, on its own</p>
              <div className="mt-2">
                <Popover>
                  <PopoverTrigger
                    render={<Button variant="secondary">Open the calendar</Button>}
                  />
                  <PopoverContent align="start" className="w-auto p-2">
                    <Calendar mode="single" selected={date} onSelect={setDate} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
          <Caption>
            Type &ldquo;9:20&rdquo; into the time field and it snaps to the nearest
            15-minute step rather than rejecting the entry. The calendar
            only ever renders inside a popover, which mounts when it is
            opened - it is never server-rendered, so react-day-picker
            deriving &ldquo;today&rdquo; at render time cannot cause a mismatch.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="9"
          title="Dropdowns, menus and pickers"
          note="The menu is exactly the trigger's width. Selected and hovered look different: selected is primary-subtle with a tick, hovered is neutral grey. Sharing one style makes it impossible to tell what is actually chosen."
        >
          <div className="flex flex-wrap items-start gap-6">
            <div className="w-64">
              <Label htmlFor="ks-select">Region</Label>
              <div className="mt-2">
                <Select defaultValue="north" items={REGIONS}>
                  <SelectTrigger id="ks-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="north">North</SelectItem>
                    <SelectItem value="south">South</SelectItem>
                    <SelectItem value="east">East</SelectItem>
                    <SelectItem value="west">West</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="w-64">
              <Label htmlFor="ks-select-empty">Empty</Label>
              <div className="mt-2">
                <Select items={REGIONS}>
                  <SelectTrigger id="ks-select-empty">
                    <SelectValue placeholder="Select a region" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="north">North</SelectItem>
                    <SelectItem value="south">South</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="w-64">
              <Label htmlFor="ks-select-grouped">Grouped options</Label>
              <div className="mt-2">
                {/*
                  SelectLabel requires a SelectGroup parent for the same
                  reason DropdownMenuLabel requires a DropdownMenuGroup:
                  it renders Base UI's GroupLabel, which throws without the
                  group, and the group is what the label names. Nothing in
                  this kit rendered it until 17 Sep 2026, so the first
                  product to group a select would have found that out on a
                  blank page.
                */}
                <Select defaultValue="north" items={REGIONS}>
                  <SelectTrigger id="ks-select-grouped">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Inland</SelectLabel>
                      <SelectItem value="north">North</SelectItem>
                      <SelectItem value="south">South</SelectItem>
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>Coastal</SelectLabel>
                      <SelectItem value="east">East</SelectItem>
                      <SelectItem value="west">West</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <Caption>
                Group labels are not options. They are 12px muted text and
                they are not selectable.
              </Caption>
            </div>

            <div className="pt-6">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="secondary">Row actions</Button>}
                />
                <DropdownMenuContent>
                  {/*
                    DropdownMenuLabel renders Base UI's GroupLabel, which
                    throws without a Group parent. It is not decoration:
                    the group is what the label is the accessible name
                    OF. Without this wrapper the menu threw on open and
                    took the whole page down with it.
                  */}
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Halcyon Supplies</DropdownMenuLabel>
                    <DropdownMenuItem>
                      <PencilIcon />
                      Edit customer
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <DownloadIcon />
                      Download orders
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="danger">
                    <TrashIcon />
                    Delete customer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {/* Section 6.8 in menu items: the same count, 8px from the
                  label, as on the Filter button and the tabs. */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="secondary">Saved views</Button>}
                />
                <DropdownMenuContent>
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Open a saved view</DropdownMenuLabel>
                    <DropdownMenuItem>
                      Overdue
                      <Count value={3} />
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      Due this week
                      <Count value={12} />
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      All open orders
                      <Count value={148} />
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="pt-6">
              {/*
                DropdownMenuRadioItem requires a DropdownMenuRadioGroup
                parent and throws without it. The RadioGroup also supplies
                the group context the label needs, which is why the label
                sits inside it rather than in a second DropdownMenuGroup -
                Base UI's own error names either as the required parent.
                A radio menu is for choosing ONE of a set, and the current
                choice carries a tick; a menu of actions uses
                DropdownMenuItem instead (section 16 decides which).
              */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="secondary">Sort by</Button>}
                />
                <DropdownMenuContent>
                  <DropdownMenuRadioGroup
                    value={sortKey}
                    onValueChange={(value) => setSortKey(String(value))}
                  >
                    <DropdownMenuLabel>Sort this list by</DropdownMenuLabel>
                    {Object.entries(SORT_KEYS).map(([value, label]) => (
                      <DropdownMenuRadioItem key={value} value={value}>
                        {label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <Caption>
                The chosen row is primary-subtle with a tick, exactly as a
                select behaves. Hovered is neutral grey, so the two never
                read as the same thing — including on the chosen row
                itself, which keeps its tint under the pointer (16.2).
              </Caption>
            </div>

            <div className="pt-6">
              {/* Several independent on/off choices: checkbox items. The
                  label needs a DropdownMenuGroup parent (section 4.1). */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="secondary">Columns</Button>}
                />
                <DropdownMenuContent>
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                    <DropdownMenuCheckboxItem defaultChecked>Order</DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem defaultChecked>Date</DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem>Units</DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem defaultChecked>Amount</DropdownMenuCheckboxItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="pt-6">
              <Popover>
                <PopoverTrigger render={<Button variant="secondary">Filter panel</Button>} />
                <PopoverContent align="start">
                  {/* Section 36: PopoverHeader is a brand band, and it
                      has to bleed through PopoverContent's own p-4 to
                      span the full width (36.2). Rendered here because
                      until now it was never rendered anywhere, which
                      section 6.4 counts as unverified rather than
                      working. */}
                  <PopoverHeader>
                    <PopoverTitle>Filters</PopoverTitle>
                    <PopoverDescription>
                      Two active on this list.
                    </PopoverDescription>
                  </PopoverHeader>
                  <p className="text-label text-text-secondary">Region</p>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Checkbox id="ks-f1" defaultChecked />
                      <Label htmlFor="ks-f1">North</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox id="ks-f2" />
                      <Label htmlFor="ks-f2">South</Label>
                    </div>
                  </div>
                  {/* PopoverFooter draws the separator and the button row on
                      desktop; on phone it becomes the sheet's footer (41.8). */}
                  <PopoverFooter>
                    <Button variant="secondary" size="sm">
                      Clear all
                    </Button>
                    <Button size="sm">Apply</Button>
                  </PopoverFooter>
                </PopoverContent>
              </Popover>
            </div>

            <div className="pt-6">
              <Sheet>
                <SheetTrigger render={<Button variant="secondary">Open sheet</Button>} />
                <SheetContent side="right">
                  <SheetHeader>
                    <SheetTitle>Customer details</SheetTitle>
                    <SheetDescription>
                      A sheet is for a side task that keeps the list visible
                      behind it.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="px-4">
                    <p className="text-body text-text-secondary">
                      Halcyon Supplies, North region. Last order 12 Aug 2026.
                    </p>
                  </div>
                  <SheetFooter>
                    <SheetClose render={<Button variant="secondary">Close</Button>} />
                  </SheetFooter>
                </SheetContent>
              </Sheet>
            </div>

            {/* Section 41.8: the bottom sheet. On phone it rises from the
                bottom with a drag handle, closes on a swipe down or Android
                back, and the select inside it opens as a step of the same
                sheet (rule 9), never a second sheet. */}
            <div data-ks-new className="pt-6">
              <Sheet>
                <SheetTrigger render={<Button variant="secondary">Open bottom sheet</Button>} />
                <SheetContent side="bottom">
                  <SheetHeader>
                    <SheetTitle>Filter orders</SheetTitle>
                  </SheetHeader>
                  <SheetBody>
                    <Label htmlFor="ks-sheet-region">Region</Label>
                    <div className="mt-2">
                      <Select defaultValue="north" items={REGIONS}>
                        <SelectTrigger id="ks-sheet-region">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="north">North</SelectItem>
                          <SelectItem value="south">South</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </SheetBody>
                  <SheetFooter>
                    <SheetClose render={<Button variant="secondary">Clear all</Button>} />
                    <SheetClose render={<Button>Show 12 results</Button>} />
                  </SheetFooter>
                </SheetContent>
              </Sheet>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-start gap-6">
            <div className="w-64">
              <Label htmlFor="ks-searchable">Sixteen options, searchable</Label>
              <div className="mt-2">
                <SearchableSelect
                  id="ks-searchable"
                  options={CATEGORIES}
                  value={category}
                  onValueChange={setCategory}
                  searchPlaceholder="Search categories"
                  emptyMessage="No category matches that search."
                />
              </div>
              <Caption>
                Section 16.3: past six options the menu gets a search box fixed
                at the top, which does not scroll with the options. This is
                what a long list uses.
              </Caption>
            </div>
            <div className="w-64">
              <Label htmlFor="ks-multi">Roles, several values</Label>
              <div className="mt-2">
                <MultiSelect
                  id="ks-multi"
                  options={ROLES}
                  value={roles}
                  onValueChange={setRoles}
                  locked={LOCKED_ROLES}
                  placeholder="Choose roles"
                  searchPlaceholder="Search roles"
                  emptyMessage="No role matches that search."
                />
              </div>
              <Caption>
                Section 16.3: choosing a row ticks it and leaves the menu open.
                + Access manager is locked, with its reason on hover, focus
                or tap (section 40.11).
              </Caption>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="10"
          title="Text overflow"
          note="Text must never overflow its container. Truncate for table cells and rows, one line ending in three dots with the full text as a tooltip. Clamp for card descriptions and previews, two lines then a Show more link."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border-light bg-surface p-4">
              <p className="text-label text-text-secondary">Truncate</p>
              <div className="mt-3 w-64 rounded-lg border border-border-light px-3 py-2">
                <Truncate>{LONG_CUSTOMER_NAME}</Truncate>
              </div>
              <Caption>Hover it: the full name appears as a tooltip.</Caption>
              <div className="mt-3 w-64 rounded-lg border border-border-light px-3 py-2">
                <Truncate>Halcyon Supplies</Truncate>
              </div>
              <Caption>
                A name that fits gets no tooltip. A tooltip that repeats what
                is already on screen is noise.
              </Caption>
            </div>
            <div className="rounded-xl border border-border-light bg-surface p-4">
              <p className="text-label text-text-secondary">Clamp</p>
              <div className="mt-3">
                <Clamp className="text-body text-text-secondary">
                  This account is billed monthly against one consolidated
                  invoice rather than per order, at the customer&rsquo;s own
                  request, and it carries a thirty day credit period agreed
                  when the contract was last renewed. Any order above two
                  lakh needs approval from the accounts team before dispatch.
                </Clamp>
              </div>
              <Caption>
                Two lines, then Show more. This is also how a grid of cards
                stays level.
              </Caption>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="11"
          title="Tabs and breadcrumbs"
          note="Breadcrumbs replace back arrows, because a back button does something different depending on how the user arrived. The active tab carries a 2px accent, primary text and medium weight - three signals together."
        >
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Customers</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Halcyon Supplies</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <Tabs defaultValue="orders" className="mt-6">
            <TabsList>
              <TabsTrigger value="orders">Orders</TabsTrigger>
              <TabsTrigger value="invoices">Invoices</TabsTrigger>
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="locked" disabled>
                Disabled
              </TabsTrigger>
            </TabsList>
            <TabsContent value="orders">
              <p className="text-body text-text-secondary">
                Orders placed by this customer. The panel keeps the same
                padding on every tab, so switching does not shift the layout.
              </p>
            </TabsContent>
            <TabsContent value="invoices">
              <p className="text-body text-text-secondary">
                Invoices raised against those orders.
              </p>
            </TabsContent>
            <TabsContent value="summary">
              <p className="text-body text-text-secondary">
                Ordered against delivered, one row per line item.
              </p>
            </TabsContent>
          </Tabs>

          {/* Section 6.8 in tabs, and 33.3: if one sibling carries a count,
              they all do. Over 99 reads 99+. */}
          <Tabs defaultValue="open" className="mt-6">
            <TabsList>
              <TabsTrigger value="open">
                Open
                <Count value={12} />
              </TabsTrigger>
              <TabsTrigger value="overdue">
                Overdue
                <Count value={3} />
              </TabsTrigger>
              <TabsTrigger value="closed">
                Closed
                <Count value={148} />
              </TabsTrigger>
            </TabsList>
            <TabsContent value="open">
              <p className="text-body text-text-secondary">12 open orders.</p>
            </TabsContent>
            <TabsContent value="overdue">
              <p className="text-body text-text-secondary">3 overdue orders.</p>
            </TabsContent>
            <TabsContent value="closed">
              <p className="text-body text-text-secondary">148 closed orders.</p>
            </TabsContent>
          </Tabs>

          <Caption>
            Those are a detail page&rsquo;s tabs: one record&rsquo;s child collections.
            Below is the other job the same component does — sibling views of
            one section, with the active view in the URL.
          </Caption>

          {/*
            Section 33. useSearchParams reads a value that only exists per
            request, so it needs a Suspense boundary above it or the route
            quietly stops being prerenderable.
          */}
          <React.Suspense
            fallback={<Skeleton className="mt-6 h-control w-full max-w-md" />}
          >
            <SectionTabsDemo />
          </React.Suspense>
          <Caption>
            The active tab is a query parameter, so a view can be linked to
            and the browser&rsquo;s own back button returns to the tab the user came
            from. Switching replaces the history entry rather than pushing
            one: flipping between three views should not make the back button
            walk through every flip. Maximum four — a fifth throws.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="12"
          title="Table"
          note="Numbers are right-aligned and text is left-aligned, always. Column headers stay put while rows scroll. A selected row is tinted primary-subtle; the total row carries body-strong weight."
        >
          <div className="overflow-hidden rounded-xl border border-border-light bg-surface">
            <Table containerClassName="max-h-64 overflow-y-auto">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-col-tick">
                    <span className="sr-only">Select</span>
                  </TableHead>
                  {/* Section 17.1: the predictable columns declare a
                      width from the col-* vocabulary; Customer is the
                      free-text column and takes the remainder, which is
                      why it is the one that truncates. */}
                  <TableHead>Customer</TableHead>
                  <TableHead className="w-col-ref">Order</TableHead>
                  <TableHead numeric className="w-col-date">Date</TableHead>
                  <TableHead numeric className="w-col-count">Units</TableHead>
                  <TableHead numeric className="w-col-amount">Amount</TableHead>
                  <TableHead className="w-col-status">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ORDERS.map((o, i) => (
                  <TableRow key={o.order} selected={i === 0}>
                    <TableCell>
                      <Checkbox defaultChecked={i === 0} aria-label={o.customer} />
                    </TableCell>
                    {/* Section 11.1.2: the name is a real link, and the
                        whole row follows it. The tick box does not. */}
                    <TableCell className="max-w-48">
                      <TableRowLink href={`#order-${o.order}`}>
                        <Truncate>
                          {i === 2 ? LONG_CUSTOMER_NAME : o.customer}
                        </Truncate>
                      </TableRowLink>
                    </TableCell>
                    <TableCell>{o.order}</TableCell>
                    <TableCell numeric>{o.date}</TableCell>
                    <TableCell numeric>{o.units}</TableCell>
                    <TableCell numeric>{o.amount}</TableCell>
                    <TableCell>
                      <Badge variant={o.status}>
                        <StatusIcon status={o.status} />
                        {o.status === "success"
                          ? "Paid"
                          : o.status === "warning"
                            ? "Pending"
                            : "Overdue"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell />
                  <TableCell>Total</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell numeric>3,035</TableCell>
                  <TableCell numeric>30,49,730.00</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
            <PaginationBar>
              <PaginationCount>1–8 of 148</PaginationCount>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious href="#" />
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#" isActive>
                      1
                    </PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#">2</PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#">3</PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext href="#" />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </PaginationBar>
          </div>
          <div className="mt-4">
            <PageSizeSentence />
          </div>
          <Caption>
            Section 17.1: every column except Customer declares a width
            from the <code>col-*</code> vocabulary, and Customer takes the
            remainder — which is why it is the one that truncates, with a
            tooltip, when a name outruns it. Sized the other way round, a
            single long value in any cell would size its own column from
            its content and take the space from the rest: before these
            widths were declared, a pasted paragraph in the Order cell
            took that column from 165 to 585px and squeezed Date from 188
            to 84. Eight rows in a 256px box, so the header stays put
            while the body scrolls. Amounts and dates are static text
            here; the formatting utilities for the rupee symbol, Indian
            digit grouping and DD Mon YYYY are not built yet.
          </Caption>

          {/* Section 34. A report table, which is a different thing from
              the list table above: read-only, does not paginate, and its
              total row is the answer. */}
          <div className="mt-8 overflow-hidden rounded-xl border border-border-light bg-surface">
            <Table containerClassName="max-h-56 overflow-auto">
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-(--z-sticky) w-grid-head bg-primary after:absolute after:top-0 after:right-0 after:h-full after:border-r after:border-primary">
                    Region
                  </TableHead>
                  {REPORT_MONTHS.map((m) => (
                    <TableHead key={m} numeric className="min-w-grid-cell">
                      {m}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {REPORT_ROWS.map((row) => (
                  <TableRow key={row.region}>
                    {/* Section 34.3: the row spine. `frozen` carries the
                        sticky-left and the 1px border so the call site
                        cannot ship one without the other. */}
                    <TableRowHeader frozen>{row.region}</TableRowHeader>
                    {row.values.map((v, i) => (
                      <TableCell key={REPORT_MONTHS[i]} numeric>
                        {v}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter sticky>
                <TableRow>
                  {/* In a footer the spine drops its tint: the total row
                      owns this cell (34.3, and 31.3 for the same call at
                      the grand total). */}
                  <TableRowHeader frozen>Total</TableRowHeader>
                  {REPORT_TOTALS.map((t, i) => (
                    <TableCell key={REPORT_MONTHS[i]} numeric>
                      {t}
                    </TableCell>
                  ))}
                </TableRow>
              </TableFooter>
            </Table>
          </div>
          <Caption>
            Section 34. The total row is pinned the same way the column
            header is — a header says what a column means, a total says what
            the report concluded, and the second is the one worth keeping on
            screen. The first column freezes when the table scrolls sideways,
            with a 1px right border so cells sliding underneath read as a
            boundary rather than as clipping. It does not paginate: a report
            has as many rows as it has, and a table whose rows grow with use
            is a list and does paginate.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="13"
          title="Cards"
          note="12px radius, a 1px border-light edge and shadow-card. A clickable record card rises to shadow-menu on hover, the only shadow that changes (5.4 rule 3). Descriptions clamp to two lines so a grid of cards stays level."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Section 36.10: this one IS a record, so it takes no
                band — its title is the content rather than a label on
                the content. The two beside it are panels and keep
                theirs. */}
            <Card variant="record">
              {/* Section 36.3: CardTitle and CardAction go in the title
                  row; CardDescription is pulled out of it by CardHeader
                  and rendered below. It has to be a DIRECT child for
                  that to find it. */}
              <CardHeader>
                <CardTitle className="min-w-0">
                  <CardLink href="#customer-halcyon">Halcyon Supplies</CardLink>
                </CardTitle>
                <CardAction>
                  <Badge variant="success">
                    <CheckIcon />
                    Active
                  </Badge>
                </CardAction>
                <CardDescription>
                  North region · 1,240 units · 12 open orders
                </CardDescription>
              </CardHeader>
              <CardContent className="pb-4">
                <p className="text-body text-text-secondary">
                  The whole card opens the record (11.6). There is no View
                  button: the title is the link and the card follows it.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Loading</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Separator</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-body text-text-secondary">Above the line</p>
                <Separator className="my-3" />
                <p className="text-body text-text-secondary">Below the line</p>
              </CardContent>
              <CardFooter>
                <Button variant="secondary" size="sm">
                  Edit notes
                </Button>
              </CardFooter>
            </Card>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="14"
          title="Charts"
          note="Section 21. The six categorical colours are used in order and the caller cannot reach a status colour, so a red bar meaning a quarter is not an available mistake. Bars start at zero, a seventh series throws rather than inventing a colour, and every bar carries its own value so the eye never travels to a legend and back."
        >
          <Card>
            <CardHeader>
              <CardTitle>Revenue by region</CardTitle>
              <CardDescription>
                Two series over the same categories.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CategoryBarChart
                data={CHART_ROWS}
                category={(r) => r.region}
                series={[
                  {
                    label: "Planned",
                    value: (r) => r.planned,
                    format: (r) => r.plannedText,
                  },
                  {
                    label: "Actual",
                    value: (r) => r.actual,
                    format: (r) => r.actualText,
                  },
                ]}
              />
            </CardContent>
          </Card>
          <Caption>
            The chart measures its own container rather than using
            ResponsiveContainer, because a ResizeObserver never fires in a
            tab that is not being painted — including an automated check run
            against a background tab. It measures once directly on mount,
            then observes.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="15"
          title="Messages"
          note="Can the user ignore it and carry on? Yes and temporary means a toast. Yes but it stays true means a banner. No means a dialog. About one field means an inline field error. A toast is never used for a field validation error."
        >
          <div className="flex flex-col gap-4">
            <p className="text-label text-text-secondary">On a page: one line (section 7.5)</p>
            <ClosableBannerDemo />

            <Banner variant="neutral" layout="line">
              <CircleAlertIcon />
              <BannerDescription>
                This purchase order is approved, so it can no longer be edited.
              </BannerDescription>
              <BannerAction>
                <Button size="sm" variant="secondary">
                  Request change
                </Button>
              </BannerAction>
            </Banner>

            <Banner variant="danger" layout="line">
              <OctagonXIcon />
              <BannerDescription>We could not load what you can do here.</BannerDescription>
              <BannerAction>
                <Button size="sm" variant="secondary">
                  Try again
                </Button>
              </BannerAction>
            </Banner>
            <Caption>
              Section 7.5 rule 4: these two explain why something cannot be
              done, so they have no close.
            </Caption>

            <p className="mt-2 text-label text-text-secondary">
              Inside a form or dialog: read whole (section 7.5 rule 2)
            </p>
            <Banner variant="success">
              <CheckIcon />
              <BannerTitle>The file is ready to import</BannerTitle>
              <BannerDescription>
                All 1,240 rows passed the checks. Import them to add the
                customers.
              </BannerDescription>
            </Banner>

            <Banner variant="danger">
              <OctagonXIcon />
              <BannerTitle>The order could not be saved</BannerTitle>
              <BannerDescription>
                The connection dropped partway through. Nothing was recorded,
                so the entry is safe to submit again.
              </BannerDescription>
              <BannerAction>
                <Button size="sm" variant="secondary">
                  Try again
                </Button>
              </BannerAction>
            </Banner>
          </div>

          <div className="mt-6">
            <Row>
              <Button variant="secondary" onClick={() => toast.success("Customer saved")}>
                Success toast
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  toast.error("The order could not be saved. Nothing was recorded.")
                }
              >
                Error toast, never auto-dismisses
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  toast.undo("9 orders archived", () => {}, { undone: "9 orders restored" })
                }
              >
                Toast with Undo
              </Button>
              <Button
                data-ks-new
                variant="secondary"
                onClick={() =>
                  toast.success("Statement sent", {
                    description: "Emailed to accounts@halcyon.in for September 2026.",
                  })
                }
              >
                Toast with a description
              </Button>
            </Row>
            <Caption>
              Bottom right, 360px fixed, at most three stacked, every one with
              a close button. The Undo toast lasts 10 seconds, and Ctrl+Z
              outside a text field presses its Undo while it shows (38.1,
              39.5). Undo is for a reversible action like archiving;
              permanent deletion keeps its confirmation dialog instead.
            </Caption>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="16"
          title="Dialogs"
          note="Three widths: 400 for confirmations, 560 for short forms, 800 when there are tabs or a table inside. A confirmation that does not state the consequences is not a confirmation, it is a speed bump."
        >
          <Row>
            <Dialog>
              <DialogTrigger
                render={<Button variant="secondary">Short form, 560px</Button>}
              />
              <DialogContent size="md">
                <DialogHeader>
                  <DialogTitle>Add line item</DialogTitle>
                  <DialogDescription>
                    The unit price is multiplied by the quantity to give the
                    line total.
                  </DialogDescription>
                </DialogHeader>
                <DialogBody>
                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-12 sm:col-span-6">
                      <Label htmlFor="ks-item" required>
                        Item
                      </Label>
                      <Input id="ks-item" className="mt-2" placeholder="Gaskets" />
                    </div>
                    <div className="col-span-12 sm:col-span-3">
                      <Label htmlFor="ks-unit-price" required>
                        Unit price
                      </Label>
                      <Input
                        id="ks-unit-price"
                        className="mt-2 text-right"
                        placeholder="34.00"
                      />
                    </div>
                  </div>
                </DialogBody>
                <DialogFooter>
                  <DialogClose render={<Button variant="secondary">Cancel</Button>} />
                  <Button>Add line item</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog>
              <DialogTrigger
                render={<Button variant="secondary">One field, 400px</Button>}
              />
              <DialogContent size="sm">
                <DialogHeader>
                  <DialogTitle>Rename view</DialogTitle>
                </DialogHeader>
                <DialogBody>
                  <Label htmlFor="ks-view-name" required>
                    View name
                  </Label>
                  <Input id="ks-view-name" className="mt-2" defaultValue="Overdue this month" />
                </DialogBody>
                <DialogFooter>
                  <DialogClose render={<Button variant="secondary">Cancel</Button>} />
                  <Button>Save view</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog>
              <DialogTrigger
                render={<Button variant="secondary">Table inside, 800px</Button>}
              />
              <DialogContent size="lg">
                <DialogHeader>
                  <DialogTitle>Orders for Halcyon Supplies</DialogTitle>
                </DialogHeader>
                <DialogBody>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-col-ref">Order</TableHead>
                        <TableHead numeric className="w-col-date">Date</TableHead>
                        <TableHead numeric className="w-col-amount">Amount</TableHead>
                        <TableHead className="w-col-status">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ORDERS.slice(0, 4).map((o) => (
                        <TableRow key={o.order}>
                          <TableCell>{o.order}</TableCell>
                          <TableCell numeric>{o.date}</TableCell>
                          <TableCell numeric>{o.amount}</TableCell>
                          <TableCell>
                            <Badge variant={o.status}>
                              <StatusIcon status={o.status} />
                              {o.status === "success"
                                ? "Paid"
                                : o.status === "warning"
                                  ? "Pending"
                                  : "Overdue"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </DialogBody>
                <DialogFooter>
                  <DialogClose render={<Button>Close</Button>} />
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <CommandPaletteDemo />

            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="danger">Delete customer</Button>} />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Halcyon Supplies?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will also remove 11 orders and 214 invoice lines. It
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction>Delete customer</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Row>
          <Caption>
            The confirm button states the actual verb, never OK or Yes. Cancel
            is the safer option and sits on the left. A confirmation closes
            only through Cancel or the action, so Escape and the backdrop do
            nothing.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="17"
          title="Empty states"
          note="Three, not one. The variant is a closed set rather than free-form props, because offering 'Add your first customer' to someone whose filter simply matched nothing makes the software look unintelligent."
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-border-light bg-surface">
              <EmptyState
                variant="nothing-yet"
                heading="No customers yet"
                actionLabel="Add customer"
              >
                A customer holds the contact details, the credit limit and the
                order history for one account. Add the first one to begin.
              </EmptyState>
            </div>
            <div className="rounded-xl border border-border-light bg-surface">
              <EmptyState variant="nothing-found" heading="No customers match “harbour”">
                Two filters are still applied. Clearing them will widen the
                search.
              </EmptyState>
            </div>
            <div className="rounded-xl border border-border-light bg-surface">
              <EmptyState variant="failed" heading="The list could not be loaded">
                The connection dropped while fetching customers. Nothing has
                changed.
              </EmptyState>
            </div>
          </div>
          {/* Section 11.8: the three error pages are built from the same
              component. Their words are fixed by the rulebook, so the
              variants carry them and the call site passes only where
              "Go to dashboard" leads (and the reference code). */}
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-border-light bg-surface">
              <EmptyState variant="not-found" dashboardHref="#dashboard" />
            </div>
            <div className="rounded-xl border border-border-light bg-surface">
              <EmptyState variant="no-access" dashboardHref="#dashboard" />
            </div>
            <div className="rounded-xl border border-border-light bg-surface">
              <EmptyState
                variant="failed"
                dashboardHref="#dashboard"
                reference="8F2K"
                onAction={() => toast.message("Trying again")}
              />
            </div>
          </div>
          {/* Section 41.15 rule 9: My work with nothing waiting is the one
              empty state with no action - there is nothing to create. */}
          <div data-ks-new className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-border-light bg-surface">
              <EmptyState variant="nothing-waiting" />
            </div>
            {/* Section 41.11: a computer-only screen opened on a phone. */}
            <div className="rounded-xl border border-border-light bg-surface">
              <EmptyState variant="desktop-only" homeHref="#home" headingLevel={2} />
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="18"
          title="Loading"
          note="Skeletons in the shape of the content that is coming, never a spinning wheel. The layout arrives first, so the page does not jump when the data lands."
        >
          <div className="overflow-hidden rounded-xl border border-border-light bg-surface">
            <div className="flex items-center gap-4 border-b border-border-light bg-surface-sunken px-4 py-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ml-auto h-control w-28" />
            </div>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center gap-4 border-b border-border-light px-4 py-3 last:border-b-0"
              >
                <Skeleton className="h-4 w-4 rounded-(--radius-tick)" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="ml-auto h-4 w-24" />
              </div>
            ))}
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="19"
          title="Scrollbars"
          note="The browser default is never used. 10px, fully rounded, in the scroll tokens. A scrolling area never nests inside another one."
        >
          <div className="max-h-40 max-w-md overflow-y-auto rounded-xl border border-border-light bg-surface p-4">
            {Array.from({ length: 14 }).map((_, i) => (
              <p key={i} className="py-1 text-body text-text-secondary">
                Row {i + 1} — the thumb and track come from the scroll tokens.
              </p>
            ))}
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="20"
          title="Board view"
          note="Section 35: the third view of a list page, beside list and card. One column per value of a single status field, one card per record. It sits in zone 3 of section 11.1 and nothing else about the page changes. The host below has a fixed height and min-h-0 — a board in a container that will not give it one renders a screen tall with its columns cut off, which is the trap section 31.4 records for the data entry grid."
        >
          <div className="mb-4">
            <ViewSwitcherDemo />
            <Caption>
              The view switcher of 11.1 zone 2: a joined group with the
              chosen side tinted primary-subtle. The board side appears only
              for a record type that has one (35.2) and only at 768px and
              above (35.3); narrower, a remembered board shows the list,
              silently. The choice is remembered per list (11.6).
            </Caption>
          </div>
          <div className="h-[420px] min-h-0 rounded-xl border border-border-light bg-surface p-4">
            <Board
              columns={BOARD_COLUMNS}
              cards={BOARD_CARDS}
              onOpenCard={(id) => toast.message(`Opening ${id}`)}
              onMove={async (cardId, toColumnId) => {
                await new Promise((resolve) => setTimeout(resolve, 400))
                if (cardId === BOARD_FAILING_CARD) {
                  throw new Error("save refused")
                }
                toast.success(`${cardId} moved to ${toColumnId}`)
              }}
            />
          </div>
          <Caption>
            Move a card with the three-dot menu — it lists every column
            except the one the card is already in, because a card cannot
            move to where it is. The move is optimistic: the card lands
            immediately and goes back if the save fails. Move{" "}
            <strong className="font-medium">Delta Fabrication</strong> to
            see that happen — its save is rigged to fail, the card returns
            to New and an error toast states the cause and the next
            action. Error toasts never auto-dismiss.{" "}
            <strong className="font-medium">Ardent Industrial</strong>{" "}
            cannot be moved at all: its menu is disabled and the reason is
            on a wrapper, because a disabled control carries
            pointer-events-none and can never show a tooltip of its own.
            Packed holds 31 records and renders 25 — the header states the
            true total throughout, not what it has drawn. Delivered is
            empty and says so in one line; section 13&rsquo;s three parts
            repeated across four columns would be four invitations to
            create a record in a stage nobody asked about.
          </Caption>
          <Caption>
            <strong className="font-medium">Dragging is the same action.</strong>{" "}
            Press and move anywhere on a card — there is no grip handle,
            and what separates a drag from a click is distance, not a
            target. On the keyboard, space picks the focused card up,
            left and right arrows step between columns, space drops and
            escape cancels; enter is left alone so it still opens the
            record. Up and down are deliberately unhandled: a drop is
            addressed to a column, not to a position inside one, and a
            gesture that looked like reordering while nothing saved the
            order would be a lie.
            Dragging Delta Fabrication fails and reverts exactly as the
            menu does, because both end in the same call. The menu is not
            a fallback for the drag — it is the baseline, and the drag
            sits on top of it.
          </Caption>
          <div
            data-force="drop-target"
            className="mt-6 h-[260px] min-h-0 rounded-xl border border-border-light bg-surface p-4"
          >
            <Board
              columns={BOARD_COLUMNS.slice(0, 3)}
              cards={BOARD_CARDS.filter((c) => c.columnId === "dispatched").slice(0, 1)}
              onMove={() => {}}
            />
          </div>
          <Caption>
            The drop indicator, held still. The column a card would land
            in is tinted <code>primary-subtle</code> with a{" "}
            <code>primary-border</code> edge — the same token, meaning the
            same thing, as a selected row. The whole column is tinted
            rather than a line drawn inside it, because the drop is
            addressed to the column and a narrower indicator would promise
            a precision the action does not have. Shown here beside two
            untargeted columns, because a tint proves nothing without
            something to be distinguished from.
          </Caption>
          <Caption>
            The board scrolls sideways and each column scrolls
            independently down. Those are different axes, so section 1
            rule 8 is not engaged — what would engage it is the page
            scrolling vertically behind a column that does the same,
            which is why the fixed height above is a requirement and not
            a preference. The board is offered at 768px and above only:{" "}
            <code>useBoardAvailable()</code> reports{" "}
            <strong className="font-medium">
              {boardAvailable ? "available" : "not available"}
            </strong>{" "}
            at this width, and a view switcher asks it rather than each
            screen writing the breakpoint out again.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="21"
          title="Brand headers"
          note="Section 36: a header band is the chrome that labels the content beneath it, and it is filled with the brand. Two tests decide it — the header labels what is under it, and it spans the full width of its container. An inline label never qualifies, however much it looks like a heading."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              <p className="text-label text-text-secondary">
                Outermost: the solid band
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead numeric>Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>Halcyon Supplies</TableCell>
                    <TableCell numeric>4,200.00</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Meridian Works</TableCell>
                    <TableCell numeric>1,150.00</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-label text-text-secondary">
                Nested: the accent form
              </p>
              <Card>
                <CardHeader>
                  <CardTitle>Outstanding invoices</CardTitle>
                  <CardAction>
                    <Button
                      variant="on-brand"
                      size="icon"
                      aria-label="Card actions"
                    >
                      <EllipsisIcon />
                    </Button>
                  </CardAction>
                </CardHeader>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead numeric>Outstanding</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>Halcyon Supplies</TableCell>
                      <TableCell numeric>4,200.00</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Meridian Works</TableCell>
                      <TableCell numeric>1,150.00</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Card>
            </div>
          </div>

          <Caption>
            The same table twice. On the left it is the outermost band
            and takes the solid brand fill; on the right it sits inside
            a card that is already banded, so it drops to the accent
            form — surface fill, labels in{" "}
            <code>primary</code>, a 2px <code>primary</code> rule. Two
            solid bands with a hairline between them read as a rendering
            fault, which is the same mistake section 6.3.1 calls a box
            inside a box.
          </Caption>
          <Caption>
            Nothing on either call site says which form to use.{" "}
            <strong className="font-medium">
              The component resolves it
            </strong>{" "}
            — a banded region publishes its level and a header inside
            reads it. That is deliberate rather than clever: section 24
            records three of four dialogs forgetting to wrap their own
            body, which indicted the component rather than the callers.
            The scope is published by the CONTAINER, not by the band,
            because a card in a dialog&apos;s body is a sibling of the
            dialog&apos;s header rather than a child of it.
          </Caption>
          <Caption>
            The card header carries a three-dot menu in the{" "}
            <code>on-brand</code> variant of section 6.3.2 — no fill and
            no border, because the band is already the container. It is
            the same rule as the icon button inside a field, with a
            different container, and its focus ring reverses to{" "}
            <code>on-brand</code>: <code>primary-ring</code> is a
            mid-tone of the brand and on a <code>primary</code> ground it
            is very nearly the ground.
          </Caption>
          <Caption>
            Two surfaces are deliberately excluded. A confirmation
            (section 15) and a banner keep their plain headers, because
            section 2.4 settles that status colours carry meaning rather
            than brand — a brand band across the top of a delete
            confirmation puts the product&apos;s identity exactly where
            the warning belongs. The report total row above stays
            neutral for a related reason: a header says what a column
            means, a total says what the report concluded, and an answer
            belongs in the reader&apos;s own text colour.
          </Caption>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="22"
          title="Links, behaviour and pages"
          note="A link goes somewhere; a button does something (6.6). The behaviours of sections 11.3, 38 and 39 are components too, and the page shapes that are not components live under /demo."
        >
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <p className="text-label text-text-secondary">Text links, 6.6</p>
              <div className="flex flex-wrap items-center gap-6">
                <TextLink href="#links">Forgot your password?</TextLink>
                <TextLink href="https://example.com">Supplier portal</TextLink>
                <TextLink>Link with nowhere to go</TextLink>
              </div>
              <p className="max-w-[70ch] text-body text-text-primary">
                Payment is due within 30 days, as set out in the{" "}
                <TextLink appearance="inline" href="#links">
                  payment terms
                </TextLink>{" "}
                agreed with the customer.
              </p>
              <div className="rounded-lg bg-primary px-4 py-3">
                <TextLink appearance="on-brand" href="#links">
                  View all notifications
                </TextLink>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-label text-text-secondary">Unsaved changes, 11.3 rule 10</p>
              <UnsavedChangesDemo />
              <p className="mt-4 text-label text-text-secondary">The same on a create form</p>
              <UnsavedCreateDemo />
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-label text-text-secondary">Keyboard, 39.5</p>
              <Row>
                <ShortcutsButton />
                <CommandPaletteDemo />
              </Row>
              <Caption>
                Press ? outside a field for the list, Ctrl+K for search, and
                Ctrl+Z to press the Undo of a showing toast. Ctrl+Enter saves
                the delivery notes above; in a comment box Enter sends.
              </Caption>
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-label text-text-secondary">Pages and the shell</p>
              <ul className="flex flex-col gap-2">
                <li><TextLink href="/demo/shell">Application shell (12), progress bar and notification centre</TextLink></li>
                <li><TextLink href="/demo/sign-in">Sign-in page (11.7)</TextLink></li>
                <li><TextLink href="/demo/errors/not-found">Error pages, signed out (11.8)</TextLink></li>
                <li><TextLink href="/demo/shell/no-access">Error pages inside the shell (11.8 rule 1)</TextLink></li>
                <li><TextLink href="/demo/behaviour">Links, unsaved changes, Undo and the keyboard</TextLink></li>
              </ul>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------- */}
        <Section
          n="23"
          title="Phone foundation"
          note="Section 41.2: a screen whose shorter side is under 600px gets the phone layout, whatever its width. On a computer this section shows the desktop values. Open it on a phone, or in _kit-only/phone-preview.mjs, to see the phone ones."
        >
          <PhoneFoundationDemo />
        </Section>

        {/* ---------------------------------------------------------- */}
        <div data-ks-new>
          <Section
            n="24"
            title="Phone screens"
            note="Section 41.5 to 41.7: the parts phone screens are built from. The rows, the record parts and the activity list show only in the phone layout; the choice rows and the text button on a band show in both. The whole phone list, the add button and the action bar are fixed to the screen, so they are shown working in /demo/shell/customers and /demo/shell/orders. Open this page in _kit-only/phone-preview.mjs to see the phone parts."
          >
            <PhoneScreensDemo />
          </Section>
        </div>

        {/* ---------------------------------------------------------- */}
        <Section
          n="25"
          title="Comment thread"
          note="Section 41.6 rule 5: oldest at the top, newest at the bottom, opening on the latest. Each comment has the photo, name and time with the text under it at full width; several in a row from one person sit together. Days are divided, a note is a grey line between comments, and the tag is the product's word. On a computer the thread scrolls inside itself; on phone the page scrolls."
        >
          <CommentThreadDemo />
        </Section>
      </div>
    </main>
    </KeyboardShortcuts>
  )
}

/**
 * command.tsx inside its dialog, through the page's one KeyboardShortcuts
 * (39.5): this button and Ctrl+K open the same palette.
 */
function CommandPaletteDemo() {
  const { openSearch } = useKeyboardShortcuts()
  return (
    <Button variant="secondary" onClick={openSearch}>
      Command palette
    </Button>
  )
}

/** Opens the "Keyboard shortcuts" dialog, as ? does. */
function ShortcutsButton() {
  const { openShortcuts } = useKeyboardShortcuts()
  return (
    <Button variant="secondary" onClick={openShortcuts}>
      Keyboard shortcuts
    </Button>
  )
}

/** What Ctrl+K opens on this page. */
function KitchenSearch() {
  const { closeSearch } = useKeyboardShortcuts()
  return (
    <Command>
      <CommandInput placeholder="Search customers and actions" />
      <CommandList>
        <CommandEmpty>Nothing matches that search.</CommandEmpty>
        <CommandGroup heading="Customers">
          <CommandItem onSelect={closeSearch}>Halcyon Supplies</CommandItem>
          <CommandItem onSelect={closeSearch}>Delta Fabrication</CommandItem>
          <CommandItem onSelect={closeSearch}>Meridian Traders</CommandItem>
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={closeSearch}>
            <PlusIcon />
            Add customer
          </CommandItem>
          <CommandItem onSelect={closeSearch}>
            <DownloadIcon />
            Download orders
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

/** Section 11.1 zone 2, live: the choice is remembered for this list. */
function ViewSwitcherDemo() {
  const [view, setView] = useListView("kitchen-sink-orders", { board: true })
  return (
    <div className="flex flex-wrap items-center gap-4">
      <ViewSwitcher value={view} onValueChange={setView} board />
      <p className="text-label text-text-secondary">
        Showing the <strong className="font-medium text-text-primary">{view}</strong> view.
      </p>
    </div>
  )
}

/** Section 11.3 rule 10 on a small form: change it, then follow the link. */
function UnsavedChangesDemo() {
  const saved = { notes: "Deliver to the rear gate." }
  const [values, setValues] = React.useState(saved)
  const [stored, setStored] = React.useState(saved)
  const unsaved = useUnsavedChanges({ changed: isChanged(values, stored), noun: "customer" })
  return (
    <form
      className="flex max-w-field-max flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        setStored(values)
        toast.success("Notes saved")
      }}
    >
      <Label htmlFor="ks-unsaved-notes">Delivery notes</Label>
      <Textarea
        id="ks-unsaved-notes"
        value={values.notes}
        onChange={(e) => setValues({ notes: e.target.value })}
        onKeyDown={ctrlEnterSaves}
      />
      <div className="mt-2 flex items-center gap-4">
        <Button type="submit" size="sm">
          Save notes
        </Button>
        <TextLink href="/demo/behaviour">Go to the behaviour demo</TextLink>
      </div>
      {unsaved.warning}
    </form>
  )
}

/**
 * Section 11.3 rule 10, create wording: the invoice does not exist until
 * it is submitted, so there is nothing to save.
 */
function UnsavedCreateDemo() {
  const empty = { reference: "" }
  const [values, setValues] = React.useState(empty)
  const unsaved = useUnsavedChanges({
    changed: isChanged(values, empty),
    noun: "invoice",
    mode: "create",
  })
  return (
    <form
      className="flex max-w-field-max flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        setValues(empty)
        toast.success("Invoice added")
      }}
    >
      <Label htmlFor="ks-unsaved-reference">Invoice reference</Label>
      <Input
        id="ks-unsaved-reference"
        value={values.reference}
        onChange={(e) => setValues({ reference: e.target.value })}
        placeholder="INV-0148"
      />
      <div className="mt-2 flex items-center gap-4">
        <Button type="submit" size="sm">
          Add invoice
        </Button>
        <TextLink href="/demo/behaviour">Go to the behaviour demo</TextLink>
      </div>
      {unsaved.warning}
    </form>
  )
}

/**
 * Section 7.5 rule 3: a banner reporting a condition in the data can be
 * closed, and returns when the condition gets worse.
 */
function ClosableBannerDemo() {
  const [count, setCount] = React.useState(3)
  const { hidden, dismiss } = useBannerDismissal({
    userId: "kitchen-sink",
    condition: "customers-without-credit-limit",
    level: count,
  })
  return (
    <div className="flex flex-col gap-2">
      {/* The dismissals cookie is read on the server, so the first
          paint already shows the right one of these two. */}
      {hidden ? (
        <p className="text-body text-text-secondary">
          Closed. It returns when the count rises.
        </p>
      ) : (
        <Banner variant="warning" layout="line">
          <TriangleAlertIcon />
          <BannerDescription>
            {`${count} customers have no credit limit set`}
          </BannerDescription>
          <BannerAction>
            <Button size="sm" variant="secondary">
              Review customers
            </Button>
          </BannerAction>
          <BannerClose onClick={dismiss} />
        </Banner>
      )}
      <Row>
        <Button size="sm" variant="secondary" onClick={() => setCount((c) => c + 1)}>
          Raise the count
        </Button>
      </Row>
    </div>
  )
}

/** Section 6.7: the choice lives inside the sentence it completes. */
function PageSizeSentence() {
  const [size, setSize] = React.useState(25)
  return (
    <p className="text-body text-text-secondary">
      Show{" "}
      <InlineChoice
        label="Records per page"
        value={size}
        onValueChange={setSize}
        options={[10, 25, 50, 100].map((n) => ({ value: n, label: String(n) }))}
      />{" "}
      records per page
    </p>
  )
}

/* -------------------------------------------------------------------
   Section 41, stage 1. What the device was given, read live: the
   layout and band from useLayout() (41.2), the keyboard from
   useKeyboard() (41.13 rule 6), the safe areas (41.13 rules 1-3) and
   the bottom-bar height that toasts and sheets sit above. Then the
   controls and type at their phone sizes (41.9).
   ------------------------------------------------------------------- */

/**
 * Measures a length token as the px it resolves to. The probe takes the
 * token through its own width utility (w-safe-top, w-bottom-bar...), so
 * the reading is what the browser resolved, env() included, and no
 * inline style is written.
 */
function useProbe(widthClass: string, deps: React.DependencyList) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const [px, setPx] = React.useState("")

  React.useEffect(() => {
    const read = () => {
      if (ref.current) setPx(`${Math.round(ref.current.getBoundingClientRect().width)}px`)
    }
    read()
    window.addEventListener("resize", read)
    return () => window.removeEventListener("resize", read)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return {
    px,
    probe: <span ref={ref} aria-hidden className={cn("pointer-events-none absolute block h-0", widthClass)} />,
  }
}

function Reading({
  label,
  value,
  children,
}: {
  label: string
  value: string
  children?: React.ReactNode
}) {
  return (
    <div className="relative flex min-w-0 flex-col gap-1">
      <dt className="text-label text-text-secondary">{label}</dt>
      <dd className="text-body font-medium text-text-primary">{value || "…"}</dd>
      {children}
    </div>
  )
}

/** The rendered size of one type slot, measured rather than restated. */
function TypeSample({ slot, className }: { slot: string; className: string }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const { layout } = useLayout()
  const [size, setSize] = React.useState("")

  React.useEffect(() => {
    if (ref.current) setSize(getComputedStyle(ref.current).fontSize)
  }, [layout])

  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 border-b border-border-light py-3 last:border-b-0">
      <div ref={ref} className={cn("min-w-0 text-text-primary", className)}>
        <Truncate>{slot}</Truncate>
      </div>
      <span className="shrink-0 text-meta text-text-muted">{size}</span>
    </div>
  )
}

function PhoneFoundationDemo() {
  const { layout, band } = useLayout()
  const keyboard = useKeyboard()
  const [search, setSearch] = React.useState("Halcyon")

  const safeTop = useProbe("w-safe-top", [layout])
  const safeRight = useProbe("w-safe-right", [layout])
  const safeBottom = useProbe("w-safe-bottom", [layout])
  const safeLeft = useProbe("w-safe-left", [layout])
  const bottomBar = useProbe("w-bottom-bar", [layout, keyboard.open])
  const control = useProbe("w-control", [layout])

  return (
    <div id="phone-foundation" className="grid gap-6 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-label text-text-secondary">What this device was given</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-xl border border-border bg-surface p-4">
          <Reading label="Layout (41.2)" value={layout} />
          <Reading label="Width band (9)" value={band} />
          <Reading
            label="Keyboard (41.13 rule 6)"
            value={keyboard.open ? `Open, ${keyboard.inset}px covered` : "Closed"}
          />
          <Reading label="Bottom bar" value={bottomBar.px}>
            {bottomBar.probe}
          </Reading>
          <Reading label="Safe area, top and bottom" value={safeTop.px && `${safeTop.px} and ${safeBottom.px}`}>
            {safeTop.probe}
            {safeBottom.probe}
          </Reading>
          <Reading label="Safe area, left and right" value={safeLeft.px && `${safeLeft.px} and ${safeRight.px}`}>
            {safeLeft.probe}
            {safeRight.probe}
          </Reading>
        </dl>
        <Caption>
          The safe areas read 0px except on a phone with a notch, camera
          hole or home indicator. The bottom bar stays 0px until the phone
          tab bar (stage 2) or action bar (stage 4) is showing.
        </Caption>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-label text-text-secondary">
          Controls (41.9 rule 2), default height {control.px || "…"}
        </p>
        <div className="relative flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
          {control.probe}
          <Row>
            <Button size="sm" variant="secondary">Small</Button>
            <Button variant="secondary">Default</Button>
            <Button size="lg">Large</Button>
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon" aria-label="Add customer" />}
              >
                <PlusIcon />
              </TooltipTrigger>
              <TooltipContent>Add customer</TooltipContent>
            </Tooltip>
          </Row>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ks-phone-keyboard">Customer name</Label>
            <Input
              id="ks-phone-keyboard"
              placeholder="Halcyon Supplies"
              autoComplete="organization"
              enterKeyHint="next"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ks-phone-password">Password</Label>
            <PasswordInput id="ks-phone-password" autoComplete="new-password" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ks-phone-search">Search customers</Label>
            <InputGroup>
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                id="ks-phone-search"
                type="search"
                enterKeyHint="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search ? (
                <InputGroupAddon align="inline-end">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <InputGroupButton
                          size="icon-xs"
                          aria-label="Clear search"
                          onClick={() => setSearch("")}
                        />
                      }
                    >
                      <XIcon />
                    </TooltipTrigger>
                    <TooltipContent>Clear search</TooltipContent>
                  </Tooltip>
                </InputGroupAddon>
              ) : null}
            </InputGroup>
          </div>
        </div>
        <Caption>
          On phone all three button sizes are 44px: hierarchy comes from the
          variant and the width, not the height. The eye button inside the
          password field and the clear button in the search field are 36px.
          Field text is 16px, so iPhone does not zoom when a field is tapped
          (41.9 rule 5).
        </Caption>
        <p className="text-label text-text-secondary">
          On a phone, tap the name field to open the keyboard, and watch the
          keyboard reading change.
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-3 lg:col-span-2">
        <p className="text-label text-text-secondary">Type at its rendered size (41.9)</p>
        <div className="rounded-xl border border-border bg-surface px-4">
          <TypeSample slot="Page title" className="text-page-title font-medium" />
          <TypeSample slot="Section heading" className="text-section font-medium" />
          <TypeSample slot="Card heading" className="text-card-heading font-medium" />
          <TypeSample slot="Body" className="text-body" />
          <TypeSample slot="Label" className="text-label text-text-secondary" />
          <TypeSample slot="Meta" className="text-meta text-text-muted" />
        </div>
        <Caption>
          Phone sizes are in rem, so they grow with the phone&apos;s text-size
          setting. On iPhone 1rem is 17px at the default setting, so these
          read about 6% larger there than the table in 41.9 says (41.9 rule 7).
        </Caption>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------
   Section 41, stage 4. The phone list row (41.5 rules 8-13), the top of
   a phone record (41.6 rules 2-5) and a choice row (41.7 rule 10). Each
   renders only in the phone layout. The action bar and the add button
   are fixed to the screen, so they are shown in the demo screens rather
   than here.
   ------------------------------------------------------------------- */
function PhoneScreensDemo() {
  return (
    <div id="phone-screens" className="flex flex-col gap-8">
      <div>
        <p className="text-label text-text-secondary">List rows (41.5)</p>
        <Caption>Not ported this phase: PhoneListRow depends on the kit&apos;s AppShell plumbing (content-area, progress-bar), which v2e does not adopt yet (D4). See ADAPTERS.md.</Caption>
      </div>

      <div>
        <p className="text-label text-text-secondary">The top of a record (41.6)</p>
        <Caption>Not ported this phase: RecordSummary/RelatedRows/KeyFacts depend on the kit&apos;s own AppShell plumbing. See ADAPTERS.md.</Caption>
      </div>

      <div>
        <p className="text-label text-text-secondary">Activity on a record (41.6 rule 5)</p>
        <Caption>Not ported this phase: ActivityList depends on the kit&apos;s own AppShell plumbing. See ADAPTERS.md.</Caption>
      </div>

      <div>
        <p className="text-label text-text-secondary">A text button on the brand band (41.6 rule 14)</p>
        <div className="mt-2 flex h-band items-center justify-between rounded-xl bg-primary px-4">
          <span className="text-bar-title font-medium text-on-brand">Orders</span>
          <Button variant="on-brand" size="sm">Select</Button>
        </div>
        <Caption>
          A text button on the band draws a 1px on-brand-muted border, so it
          reads as a button and not as a word (6.1 rule 5).
        </Caption>
      </div>

      <div>
        <p className="text-label text-text-secondary">Connection and notifications (41.14, 41.12)</p>
        <Caption>Not ported this phase: OfflineBanner and NotificationPermissionSheet depend on the kit&apos;s own AppShell and components/templates. v2e already has its own offline/notification handling (components/phone/**, lib/push.ts). See ADAPTERS.md.</Caption>
      </div>

      <div data-ks-new>
        <p className="text-label text-text-secondary">Repeating rows (41.7 rule 16)</p>
        <div className="mt-2">
          <RepeatingRowsDemo />
        </div>
        <Caption>
          On phone each line is a row that opens its own screen to edit, with
          Save in its action bar and Remove in its three-dot menu; on a
          computer the fields sit inline. Removing a line gives an Undo toast.
        </Caption>
      </div>

      <div data-ks-new>
        <p className="text-label text-text-secondary">The comment box (41.6 rule 5)</p>
        <Caption>Not ported this phase: comment-box.tsx depends on the kit&apos;s components/shell/content-area. See ADAPTERS.md.</Caption>
      </div>

      <div>
        <p className="text-label text-text-secondary">Choice rows (41.7 rule 10)</p>
        <div className="mt-2 flex flex-col">
          <ChoiceRow control={<Checkbox id="ks-choice-1" defaultChecked />} label="Email the invoice to the client" />
          <ChoiceRow
            control={<Switch id="ks-choice-2" />}
            label="Send monthly statement"
            description="On the first working day of each month."
          />
        </div>
      </div>
    </div>
  )
}

/** A badge's icon from the one map of status role to icon (badge.tsx). */
function StatusIcon({ status }: { status: keyof typeof STATUS_ICON }) {
  const Icon = STATUS_ICON[status]
  return <Icon />
}

/** Section 41.7 rule 16: lines of an order, inside any form's own state. */
type DemoLine = { id: string; item: string; qty: string; amount: string }

function RepeatingRowsDemo() {
  const [lines, setLines] = React.useState<DemoLine[]>([
    { id: "line-1", item: "Printer paper", qty: "4", amount: "1,200.00" },
  ])
  const nextId = React.useRef(2)
  return (
    <RepeatingRows<DemoLine>
      value={lines}
      onChange={setLines}
      getId={(line) => line.id}
      newRow={() => ({ id: `line-${nextId.current++}`, item: "", qty: "1", amount: "" })}
      summary={(line) => ({
        title: line.item || "New item",
        detail: `Quantity ${line.qty}`,
        amount: `₹${line.amount || "0.00"}`,
      })}
      total={{ label: "Total", value: "₹1,200.00" }}
      renderRow={(line, set) => (
        <>
          <div className="col-span-6">
            <Label htmlFor={`ks-line-item-${line.id}`}>Item</Label>
            <Input
              id={`ks-line-item-${line.id}`}
              className="mt-2"
              value={line.item}
              onChange={(event) => set({ item: event.target.value })}
            />
          </div>
          <div className="col-span-3">
            <Label htmlFor={`ks-line-qty-${line.id}`}>Quantity</Label>
            <Input
              id={`ks-line-qty-${line.id}`}
              className="mt-2 text-right"
              inputMode="numeric"
              value={line.qty}
              onChange={(event) => set({ qty: event.target.value })}
            />
          </div>
          <div className="col-span-3">
            <Label htmlFor={`ks-line-amount-${line.id}`}>Amount</Label>
            <Input
              id={`ks-line-amount-${line.id}`}
              className="mt-2 text-right"
              inputMode="decimal"
              value={line.amount}
              onChange={(event) => set({ amount: event.target.value })}
            />
          </div>
        </>
      )}
    />
  )
}


/** Section 11.7 rule 2: one input drawn as a box per digit; resting, invalid, disabled. */
function OtpFieldDemo() {
  const [value, setValue] = React.useState("")
  return (
    <div className="grid gap-6 sm:grid-cols-3">
      <div>
        <Label htmlFor="ks-otp" required>
          OTP
        </Label>
        <OtpField
          id="ks-otp"
          name="otp"
          className="mt-2"
          value={value}
          onChange={setValue}
          onComplete={(code) => toast.message(`Signing in with ${code}`)}
        />
      </div>
      <div>
        <Label htmlFor="ks-otp-wrong">OTP, wrong</Label>
        <OtpField id="ks-otp-wrong" className="mt-2" value="482915" invalid onChange={() => {}} />
      </div>
      <div>
        <Label htmlFor="ks-otp-checking">OTP, while checking</Label>
        <OtpField id="ks-otp-checking" className="mt-2" value="482915" readOnly onChange={() => {}} />
      </div>
    </div>
  )
}

/** Section 41.6 rule 5: the thread above the message box, with the box under it. */
function CommentThreadDemo() {
  // Built in the browser: "Today" and "Yesterday" are measured from now.
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
  const [older, setOlder] = React.useState<ThreadItem[]>([])
  const [sent, setSent] = React.useState<ThreadItem[]>([])
  const [text, setText] = React.useState("")

  const base = React.useMemo<ThreadItem[]>(() => {
    if (!mounted) return []
    const at = (daysAgo: number, hour: number, minute: number) => {
      const d = new Date()
      d.setDate(d.getDate() - daysAgo)
      d.setHours(hour, minute, 0, 0)
      return d.toISOString()
    }
    return [
      { id: "t1", who: "Priya Nair", when: at(3, 10, 5), tag: "Client", text: "Round 1 looks good. Can we see the footer in the second layout?" },
      { id: "t2", who: "Rakesh Mehta", when: at(3, 10, 40), text: "Yes, I will upload it this afternoon." },
      { id: "t3", who: "Rakesh Mehta", when: at(3, 10, 41), text: "It uses the same grid, so nothing else moves." },
      { id: "n1", kind: "note", when: at(1, 15, 12), text: "Rakesh uploaded round 2" },
      { id: "t4", who: "Sunita Rao", when: at(1, 15, 30), tag: "Internal", edited: true, onShowEdits: () => toast.message("Earlier versions would open here."), text: "Hold the invoice until the client approves.\nI will check again on Monday." },
      { id: "t5", who: "Priya Nair", when: at(0, 9, 20), tag: "Client", text: "Approved. Please go ahead." },
    ]
  }, [mounted])

  const more = async () => {
    await new Promise((resolve) => setTimeout(resolve, 600))
    const d = new Date()
    d.setDate(d.getDate() - 6)
    d.setHours(11, 0, 0, 0)
    setOlder([
      { id: "e1", who: "Sunita Rao", when: d.toISOString(), text: "Kick-off notes are in the project folder." },
      { id: "e2", who: "Priya Nair", when: new Date(d.getTime() + 600000).toISOString(), tag: "Client", text: "Thanks, received." },
    ])
  }

  return (
    <div className="flex flex-col gap-4">
      <CommentThread items={[...older, ...base, ...sent]} loading={!mounted} hasEarlier={older.length === 0} onShowEarlier={more} />
      <CommentBox
        value={text}
        onChange={setText}
        onSend={async () => {
          await new Promise((resolve) => setTimeout(resolve, 400))
          setSent((list) => [...list, { id: `new-${list.length}`, who: "Aryan Jain", when: new Date().toISOString(), text }])
          setText("")
        }}
      />
    </div>
  )
}
