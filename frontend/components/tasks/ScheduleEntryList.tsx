'use client'

import React from 'react'
import { Plus } from 'lucide-react'
import ScheduleEntryRow, { type ScheduleEntryDraft } from './ScheduleEntryRow'
import { getNow } from '@/lib/clock'

interface Props {
  entries: ScheduleEntryDraft[]
  onChange: (entries: ScheduleEntryDraft[]) => void
}

function defaultEntry(): ScheduleEntryDraft {
  return {
    schedule_type: 'daily',
    every: 1,
    days: [],
    month_days: [],
    yearly_dates: [],
    time: '09:00',
    start_date: getNow().toISOString().slice(0, 10),
    end_condition: 'never',
    end_date: '',
    end_after: 10,
  }
}

export default function ScheduleEntryList({ entries, onChange }: Props) {
  function addEntry() {
    onChange([...entries, defaultEntry()])
  }

  function updateEntry(index: number, patch: Partial<ScheduleEntryDraft>) {
    onChange(entries.map((e, i) => (i === index ? { ...e, ...patch } : e)))
  }

  function deleteEntry(index: number) {
    onChange(entries.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-4">
      {entries.map((entry, index) => (
        <div
          key={index}
          className="border border-border-light rounded-[10px] p-4 bg-surface-sunken space-y-4"
        >
          <ScheduleEntryRow
            entry={entry}
            index={index}
            onUpdate={(patch) => updateEntry(index, patch)}
            onDelete={() => deleteEntry(index)}
            canDelete={entries.length > 1}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={addEntry}
        className="flex items-center gap-2 text-sm font-medium text-primary-text hover:text-primary-text transition-colors"
      >
        <Plus size={15} />
        Add schedule entry
      </button>
    </div>
  )
}
