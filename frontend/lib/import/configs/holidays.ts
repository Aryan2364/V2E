import { parseCsv } from '../csv'

export interface ParsedHoliday {
  name: string
  date: string
  type: string
  is_recurring_yearly: boolean
  description: string
  _error?: string
}

export const HOLIDAY_TYPES = ['national', 'company', 'regional']

export const HOLIDAY_TEMPLATE_CSV = `Name,Date,Type,Recurring Yearly,Description
Republic Day,2025-01-26,national,yes,National holiday
Independence Day,2025-08-15,national,yes,National holiday
Gandhi Jayanti,2025-10-02,national,yes,National holiday
Diwali,2025-10-20,national,no,Festival of lights
Holi,2025-03-14,national,no,Festival of colors
`

export const HOLIDAY_TEMPLATE_FILE_NAME = 'holidays_template.csv'

/** The first problem with a holiday row, in the order the importer reports them. */
export function holidayRowError(name: string, date: string, type: string): string | undefined {
  if (!name) return 'Name is required'
  if (!date) return 'Date is required'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime())) return 'Date must be YYYY-MM-DD'
  if (type && !HOLIDAY_TYPES.includes(type)) return `Type must be: ${HOLIDAY_TYPES.join(', ')}`
  return undefined
}

/** Parse a holidays CSV: a header row (names lower-cased, spaces to underscores) then data rows. */
export function parseHolidayCsv(text: string): ParsedHoliday[] {
  const grid = parseCsv(text.trim())
  if (grid.length < 2) return []

  const header = grid[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const nameIdx = header.indexOf('name')
  const dateIdx = header.indexOf('date')
  const typeIdx = header.indexOf('type')
  const recurringIdx = header.findIndex((h) => h.includes('recurring'))
  const descIdx = header.indexOf('description')

  return grid
    .slice(1)
    .map((raw) => {
      const cols = raw.map((c) => c.trim())
      const name = nameIdx >= 0 ? (cols[nameIdx] ?? '') : ''
      const date = dateIdx >= 0 ? (cols[dateIdx] ?? '') : ''
      const type = typeIdx >= 0 ? (cols[typeIdx] ?? 'national').toLowerCase() : 'national'
      const recurring = recurringIdx >= 0 ? cols[recurringIdx]?.toLowerCase() === 'yes' : false
      const description = descIdx >= 0 ? (cols[descIdx] ?? '') : ''
      return {
        name,
        date,
        type: HOLIDAY_TYPES.includes(type) ? type : 'national',
        is_recurring_yearly: recurring,
        description,
        _error: holidayRowError(name, date, type),
      }
    })
    .filter((r) => r.name || r.date)
}
