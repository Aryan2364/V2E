'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { isChanged, useUnsavedChanges } from '@/components/ui/unsaved-changes'

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
  const [titleError, setTitleError] = useState('')
  const router = useRouter()
  // Leaving with edits asks first, in the create or edit words (kit 11.3 rule 10).
  const unsaved = useUnsavedChanges({
    changed: !saving && isChanged(form, initial),
    noun: 'policy',
    mode: initial.title ? 'edit' : 'create',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) {
      setTitleError('Enter a title for the policy.')
      requestAnimationFrame(() => document.getElementById('policy-title')?.focus())
      return
    }
    setTitleError('')
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
      <div className="bg-surface border border-border-light rounded-card p-8 flex flex-col items-center text-center gap-2">
        <Lock size={22} className="text-text-secondary" />
        <p className="text-body font-medium text-text-primary">You can read policies, but not change them</p>
        <p className="text-body text-text-secondary max-w-md">{deniedReason} Ask an administrator if you need it.</p>
        <Link href={cancelHref} className="mt-2 text-body font-medium text-primary-text hover:underline">
          Go back
        </Link>
      </div>
    )
  }

  const inputClass =
    'w-full px-3 py-2.5 border border-border rounded-lg text-card-heading sm:text-body text-text-primary placeholder:text-text-muted bg-surface focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary'

  return (
    <form onSubmit={handleSubmit} className="bg-surface border border-border-light rounded-card shadow-card p-6 flex flex-col gap-4">
      {unsaved.warning}
      {error && (
        <div className="text-body text-danger bg-danger-bg border border-danger-border rounded-lg px-4 py-3">{error}</div>
      )}

      <div>
        <Label htmlFor="policy-title" className="mb-2" required>
          Title
        </Label>
        <input
          id="policy-title"
          type="text"
          value={form.title}
          onChange={(e) => { setForm((f) => ({ ...f, title: e.target.value })); if (titleError) setTitleError('') }}
          placeholder="For example, Code of conduct"
          aria-invalid={titleError ? true : undefined}
          className={`${inputClass} max-w-[480px] aria-invalid:border-danger`}
        />
        <InlineFieldError>{titleError}</InlineFieldError>
      </div>

      <div>
        <Label htmlFor="policy-description" className="mb-2">Description</Label>
        <textarea
          id="policy-description"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="For example, How we expect everyone to work together"
          rows={3}
          className={`${inputClass} resize-none`}
        />
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" data-leaves-page onClick={() => router.push(cancelHref)} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || allowed !== true} loading={saving} loadingLabel="Saving">
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
