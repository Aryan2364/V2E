'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import DatePicker from '@/components/ui/DatePicker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import CascadeTargetTree from './CascadeTargetTree'
import type { HolidayType } from '@/lib/types/holidays'
import type { Department } from '@/lib/types'
import { Label } from '@/components/ui/label'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { useGuardedClose } from '@/lib/use-guarded-close'

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
  title = 'New holiday',
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
  // Field errors sit under the field that is wrong (kit 11.3 rule 6).
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; date?: string; end?: string }>({})
  const clearErr = (k: 'name' | 'date' | 'end') => setFieldErrors((p) => (p[k] ? { ...p, [k]: undefined } : p))

  const showCascade = !!departments && !!originDeptId && !!originDeptName

  function set<K extends keyof HolidayFormData>(key: K, val: HolidayFormData[K]) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  function reset() {
    setForm({ ...DEFAULT, type: defaultType })
    setSpan('single')
    setError('')
    setFieldErrors({})
  }

  function close() {
    if (saving) return
    reset()
    onClose()
  }

  async function submit() {
    const errs = {
      name: form.name.trim() ? undefined : 'Enter a name for the holiday.',
      date: form.date ? undefined : span === 'range' ? 'Choose the first day of the range.' : 'Choose the date of the holiday.',
      end:
        span === 'range'
          ? !form.end_date
            ? 'Choose the last day of the range.'
            : form.date && form.end_date <= form.date
              ? 'Choose an end date after the start date.'
              : undefined
          : undefined,
    }
    if (errs.name || errs.date || errs.end) {
      setFieldErrors(errs)
      const id = errs.name ? 'holiday-name' : errs.date ? 'holiday-date' : 'holiday-end'
      requestAnimationFrame(() => {
        const el = document.getElementById(id)
        ;(el?.matches('input,textarea,button') ? el : el?.querySelector<HTMLElement>('input,button'))?.focus()
      })
      return
    }
    setFieldErrors({})
    setSaving(true)
    setError('')
    try {
      // Drop end_date entirely in single-day mode.
      await onAdd({ ...form, end_date: span === 'range' ? form.end_date : '' })
      reset()
      onClose()
    } catch {
      setError('Could not add the holiday. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const guarded = useGuardedClose({ open: isOpen, values: { form, span }, noun: 'holiday', onClose: close })

  return (
    <>
    {guarded.warning}
    <Modal isOpen={isOpen} onClose={guarded.requestClose} title={title} size="md" closeOnEscape={!saving}>
      <div className="space-y-4">
        {/* Span selector — single day vs range */}
        {allowRange && (
          <div>
            <Label className="mb-2">Duration</Label>
            <div className="inline-flex p-0.5 rounded-lg bg-surface-control border border-border-light">
              {(['single', 'range'] as Span[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSpan(s)}
                  className={[
                    'outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-primary-ring px-3 py-1.5 rounded-md text-body font-medium transition-colors',
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
          <Label className="mb-2" htmlFor="holiday-name" required>Name</Label>
          <input
            id="holiday-name"
            value={form.name}
            onChange={(e) => { set('name', e.target.value); clearErr('name') }}
            placeholder="For example, Republic Day"
            autoFocus
            aria-invalid={fieldErrors.name ? true : undefined}
            className="w-full h-[42px] px-3 rounded-lg border border-border bg-surface-sunken text-body text-text-primary placeholder:text-text-muted focus:bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-hidden transition-colors aria-invalid:border-danger"
          />
          <InlineFieldError>{fieldErrors.name}</InlineFieldError>
        </div>

        {/* Date(s) */}
        {span === 'single' ? (
          <div>
            <Label className="mb-2" htmlFor="holiday-date" required>Date</Label>
            <DatePicker id="holiday-date" invalid={!!fieldErrors.date} value={form.date} onChange={(iso) => { set('date', iso); clearErr('date') }} placeholder="Select date" />
            <InlineFieldError>{fieldErrors.date}</InlineFieldError>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-2" htmlFor="holiday-date" required>Start date</Label>
              <DatePicker
                id="holiday-date"
                invalid={!!fieldErrors.date}
                value={form.date}
                onChange={(iso) => { set('date', iso); clearErr('date') }}
                placeholder="Select date"
                max={form.end_date || undefined}
              />
              <InlineFieldError>{fieldErrors.date}</InlineFieldError>
            </div>
            <div>
              <Label className="mb-2" htmlFor="holiday-end" required>End date</Label>
              <DatePicker
                id="holiday-end"
                invalid={!!fieldErrors.end}
                value={form.end_date}
                onChange={(iso) => { set('end_date', iso); clearErr('end') }}
                placeholder="Select date"
                min={form.date || undefined}
              />
              <InlineFieldError>{fieldErrors.end}</InlineFieldError>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="mb-2">Type</Label>
            <Select
              value={form.type}
              onValueChange={(v) => set('type', v as HolidayType)}
              items={HOLIDAY_TYPES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1).replace('_', ' ') }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOLIDAY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1).replace('_', ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-2">Description</Label>
            <input
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
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

        {error && <p role="alert" className="text-label text-danger">{error}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="secondary" onClick={guarded.requestClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={saving} disabled={saving}>Add holiday</Button>
        </div>
      </div>
    </Modal>
    </>
  )
}
