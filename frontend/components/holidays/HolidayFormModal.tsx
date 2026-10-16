'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/button'
import DatePicker from '@/components/ui/DatePicker'
import StyledSelect from '@/components/ui/StyledSelect'
import CascadeTargetTree from './CascadeTargetTree'
import type { HolidayType } from '@/lib/types/holidays'
import type { Department } from '@/lib/types'

const HOLIDAY_TYPES: HolidayType[] = ['national', 'company', 'regional', 'team', 'personal', 'leave']

export interface HolidayFormData {
  name: string
  date: string
  /** Inclusive end date for a range; '' for single-day. */
  end_date: string
  type: HolidayType
  is_recurring_yearly: boolean
  description: string
  /** Cascade target departments (checked descendants). Empty = this department only. */
  target_department_ids: string[]
}

type Span = 'single' | 'range'

const DEFAULT: HolidayFormData = {
  name: '',
  date: '',
  end_date: '',
  type: 'company',
  is_recurring_yearly: false,
  description: '',
  target_department_ids: [],
}

interface Props {
  isOpen: boolean
  onClose: () => void
  onAdd: (data: HolidayFormData) => Promise<void>
  title?: string
  /** Show the single/range duration selector. Off for single-day-only contexts (individuals). */
  allowRange?: boolean
  /** Pre-selected holiday type — e.g. "personal" for an individual's calendar. */
  defaultType?: HolidayType
  /** Pass these (dept context) to show the cascade control for sub-departments. */
  departments?: Department[]
  originDeptId?: string
  originDeptName?: string
}

/** Centered modal for creating a holiday — single day, or a start→end range. */
export default function HolidayFormModal({
  isOpen,
  onClose,
  onAdd,
  title = 'New Holiday',
  allowRange = true,
  defaultType = 'company',
  departments,
  originDeptId,
  originDeptName,
}: Props) {
  const [span, setSpan] = useState<Span>('single')
  const [form, setForm] = useState<HolidayFormData>({ ...DEFAULT, type: defaultType })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const showCascade = !!departments && !!originDeptId && !!originDeptName

  function set<K extends keyof HolidayFormData>(key: K, val: HolidayFormData[K]) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  function reset() {
    setForm({ ...DEFAULT, type: defaultType })
    setSpan('single')
    setError('')
  }

  function close() {
    if (saving) return
    reset()
    onClose()
  }

  async function submit() {
    if (!form.name.trim() || !form.date) {
      setError('Name and date are required.')
      return
    }
    if (span === 'range') {
      if (!form.end_date) {
        setError('Pick an end date for the range.')
        return
      }
      if (form.end_date <= form.date) {
        setError('End date must be after the start date.')
        return
      }
    }
    setSaving(true)
    setError('')
    try {
      // Drop end_date entirely in single-day mode.
      await onAdd({ ...form, end_date: span === 'range' ? form.end_date : '' })
      reset()
      onClose()
    } catch {
      setError('Failed to add holiday. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={close} title={title} size="md" closeOnEscape={!saving}>
      <div className="space-y-4">
        {/* Span selector — single day vs range */}
        {allowRange && (
          <div>
            <label className="block text-meta font-medium text-text-secondary mb-1.5">Duration</label>
            <div className="inline-flex p-0.5 rounded-lg bg-surface-control border border-border-light">
              {(['single', 'range'] as Span[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSpan(s)}
                  className={[
                    'px-3 py-1.5 rounded-md text-body font-medium transition-colors',
                    span === s ? 'bg-surface text-primary-text shadow-card' : 'text-text-muted hover:text-text-primary',
                  ].join(' ')}
                >
                  {s === 'single' ? 'Single day' : 'Range'}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-meta font-medium text-text-secondary mb-1">Name *</label>
          <input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Republic Day"
            autoFocus
            className="w-full h-[42px] px-3 rounded-lg border border-border bg-surface-sunken text-body text-text-primary placeholder:text-text-muted focus:bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-hidden transition-colors"
          />
        </div>

        {/* Date(s) */}
        {span === 'single' ? (
          <div>
            <label className="block text-meta font-medium text-text-secondary mb-1">Date *</label>
            <DatePicker value={form.date} onChange={(iso) => set('date', iso)} placeholder="Select date" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-meta font-medium text-text-secondary mb-1">Start date *</label>
              <DatePicker
                value={form.date}
                onChange={(iso) => set('date', iso)}
                placeholder="Start"
                max={form.end_date || undefined}
              />
            </div>
            <div>
              <label className="block text-meta font-medium text-text-secondary mb-1">End date *</label>
              <DatePicker
                value={form.end_date}
                onChange={(iso) => set('end_date', iso)}
                placeholder="End"
                min={form.date || undefined}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-meta font-medium text-text-secondary mb-1">Type</label>
            <StyledSelect
              value={form.type}
              onChange={(v) => set('type', v as HolidayType)}
              options={HOLIDAY_TYPES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1).replace('_', ' ') }))}
            />
          </div>
          <div>
            <label className="block text-meta font-medium text-text-secondary mb-1">Description</label>
            <input
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Optional"
              className="w-full h-[42px] px-3 rounded-lg border border-border bg-surface-sunken text-body text-text-primary placeholder:text-text-muted focus:bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-hidden transition-colors"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.is_recurring_yearly}
            onChange={(e) => set('is_recurring_yearly', e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
          <span className="text-body text-text-secondary">Repeat yearly{span === 'range' ? ' on these dates' : ' on this date'}</span>
        </label>

        {showCascade && (
          <CascadeTargetTree
            departments={departments!}
            originDeptId={originDeptId!}
            originDeptName={originDeptName!}
            value={form.target_department_ids}
            onChange={(ids) => set('target_department_ids', ids)}
          />
        )}

        {error && <p className="text-meta text-danger">{error}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="secondary" onClick={close} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={submit} isLoading={saving} disabled={saving}>Add Holiday</Button>
        </div>
      </div>
    </Modal>
  )
}
