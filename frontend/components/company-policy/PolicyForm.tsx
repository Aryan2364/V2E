'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, Lock } from 'lucide-react'

export interface PolicyFormValues {
  title: string
  description: string
}

/**
 * The create / edit form for a company policy's title and description. One form,
 * used by both /new and /[policyId]/edit. When the person may not make this change
 * (`allowed === false`) it explains instead of offering a form that would fail.
 */
export default function PolicyForm({
  initial,
  submitLabel,
  cancelHref,
  allowed,
  deniedReason,
  onSubmit,
}: {
  initial: PolicyFormValues
  submitLabel: string
  cancelHref: string
  allowed: boolean | undefined
  deniedReason: string
  onSubmit: (values: PolicyFormValues) => Promise<void>
}) {
  const [form, setForm] = useState<PolicyFormValues>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) { setError('Title is required'); return }
    setSaving(true)
    setError('')
    try {
      await onSubmit({ title: form.title.trim(), description: form.description.trim() })
    } catch (err: unknown) {
      const m = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message
      setError(Array.isArray(m) ? m.join(', ') : typeof m === 'string' && m ? m : 'Could not save the policy. Try again.')
      setSaving(false)
    }
  }

  if (allowed === false) {
    return (
      <div className="bg-white border border-border-light rounded-[12px] p-8 flex flex-col items-center text-center gap-2">
        <Lock size={22} className="text-text-secondary" />
        <p className="text-sm font-semibold text-text-primary">You can read policies, but not change them</p>
        <p className="text-sm text-text-secondary max-w-md">{deniedReason} Ask an administrator if you need it.</p>
        <Link href={cancelHref} className="mt-2 text-sm font-semibold text-primary-text hover:underline">
          Go back
        </Link>
      </div>
    )
  }

  const inputClass =
    'w-full px-3 py-2.5 border border-border rounded-[8px] text-base sm:text-sm text-text-primary placeholder:text-text-muted bg-white focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary'
  const labelClass = 'block text-sm font-medium text-text-secondary mb-1.5'

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-6 flex flex-col gap-5">
      {error && (
        <div className="text-sm text-danger bg-danger-bg border border-danger-border rounded-[8px] px-4 py-3">{error}</div>
      )}

      <div>
        <label htmlFor="policy-title" className={labelClass}>
          Title <span className="text-danger">*</span>
        </label>
        <input
          id="policy-title"
          type="text"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="e.g. Code of Conduct"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="policy-description" className={labelClass}>Description</label>
        <textarea
          id="policy-description"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Brief description of this policy…"
          rows={3}
          className={`${inputClass} resize-none`}
        />
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 pt-2">
        <Link
          href={cancelHref}
          className="text-center px-4 py-2.5 text-sm font-semibold text-primary-text bg-white border-2 border-primary rounded-[8px] hover:bg-primary-subtle transition-colors"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={saving || allowed !== true}
          className="flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] sm:min-h-0 text-sm font-semibold text-white bg-primary hover:bg-primary-hover rounded-[8px] transition-colors disabled:bg-surface-control-pressed disabled:text-text-muted disabled:cursor-not-allowed"
        >
          {saving && <Loader2 size={15} className="animate-spin" />}
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
