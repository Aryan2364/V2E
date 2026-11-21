import type { ColumnSpec } from '../types'

export type ChecklistColumn = 'checklist_name' | 'item'

export const CHECKLIST_COLUMNS: readonly ColumnSpec<ChecklistColumn>[] = [
  {
    key: 'checklist_name',
    label: 'Checklist Name *',
    required: true,
    aliases: ['checklist', 'name', 'template', 'template_name'],
  },
  { key: 'item', label: 'Item *', required: true, aliases: ['items', 'task', 'step', 'checklist_item', 'line'] },
]

export const CHECKLIST_MISSING_COLUMNS =
  'Could not find the required "Checklist Name" and "Item" columns. Download the template to see the expected format.'

export function mapChecklistRow(get: (k: ChecklistColumn) => string): { checklist_name: string; item: string } {
  return { checklist_name: get('checklist_name'), item: get('item') }
}
