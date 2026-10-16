'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Plus, Trash2 } from 'lucide-react'
import { upsertOrgIdentity } from '@/lib/api/org-identity'
import Button from '@/components/ui/button'
import type { OrgIdentity } from '@/lib/types'

interface IdentityFormDrawerProps {
  open: boolean
  orgId: string
  initial: OrgIdentity | null
  onClose: () => void
  onSaved: (saved: OrgIdentity) => void
}

// ─── Schema (mirrors setup step-1) ──────────────────────────────────────────────

const schema = z.object({
  vision: z.string().optional(),
  mission: z.string().optional(),
  purpose: z.string().optional(),
  values: z
    .array(z.object({ title: z.string().min(1, 'Value title required'), description: z.string().optional() }))
    .default([]),
})

type FormValues = {
  vision?: string
  mission?: string
  purpose?: string
  values: Array<{ title: string; description?: string }>
}

const labelCls = 'block text-sm font-semibold text-text-secondary mb-1.5'
const textareaCls =
  'w-full rounded-[8px] border border-border bg-white px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-2 focus:border-primary transition-colors resize-none'
const inputCls =
  'w-full rounded-[8px] border border-border bg-white px-3 py-[10px] text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-2 focus:border-primary transition-colors'

/**
 * Edit organization identity (vision, mission, purpose, values) from
 * a right-hand drawer — so admins edit in place in Settings instead of being sent
 * to the setup wizard. One PUT saves the whole record (upsertOrgIdentity).
 */
export default function IdentityFormDrawer({
  open,
  orgId,
  initial,
  onClose,
  onSaved,
}: IdentityFormDrawerProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: { values: [] },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'values' })

  // Hydrate each time the drawer opens.
  useEffect(() => {
    if (!open) return
    setFormError(null)
    reset({
      vision: initial?.vision ?? '',
      mission: initial?.mission ?? '',
      purpose: initial?.purpose ?? '',
      values: initial?.values ?? [],
    })
  }, [open, initial, reset])

  const onSubmit = async (data: FormValues) => {
    setFormError(null)
    try {
      const saved = await upsertOrgIdentity(orgId, data)
      onSaved(saved)
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
        ?.message
      setFormError(Array.isArray(raw) ? raw[0] : raw ?? 'Failed to save identity.')
    }
  }

  if (!mounted) return null

  return createPortal(
    <>
      {open && <div className="fixed inset-0 bg-black/20 z-60" onClick={onClose} />}

      <div
        className={`fixed inset-y-0 right-0 z-70 w-full max-w-xl bg-white border-l border-border-light shadow-[-8px_0_32px_rgba(0,0,0,0.08)] flex flex-col transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
          <h3 className="font-semibold text-text-primary">Edit Organization Identity</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-[6px] flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-control transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto min-h-0">
          <div className="px-5 py-5 flex flex-col gap-5">
            {/* Core pillars */}
            <div className="flex flex-col gap-4">
              <div>
                <label className={labelCls}>Vision</label>
                <textarea
                  {...register('vision')}
                  rows={3}
                  placeholder="What future are you working toward?"
                  className={textareaCls}
                />
              </div>
              <div>
                <label className={labelCls}>Mission</label>
                <textarea
                  {...register('mission')}
                  rows={3}
                  placeholder="What does your organization do, for whom, and why?"
                  className={textareaCls}
                />
              </div>
              <div>
                <label className={labelCls}>Purpose</label>
                <textarea
                  {...register('purpose')}
                  rows={3}
                  placeholder="Beyond profit, why does your organization exist?"
                  className={textareaCls}
                />
              </div>
            </div>

            {/* Values */}
            <div className="bg-surface-sunken border border-border-light rounded-[10px] p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-text-primary">Organizational Values</h4>
                <button
                  type="button"
                  onClick={() => append({ title: '', description: '' })}
                  className="inline-flex items-center gap-1 text-xs text-primary-text font-medium hover:text-primary-text"
                >
                  <Plus size={13} /> Add Value
                </button>
              </div>
              <div className="flex flex-col gap-3 max-h-[340px] overflow-y-auto pr-1">
                {fields.length === 0 && (
                  <p className="text-xs text-text-muted text-center py-3">No values added yet.</p>
                )}
                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="bg-white border border-border-light rounded-[8px] p-3 flex gap-3"
                  >
                    <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">
                      {index + 1}
                    </div>
                    <div className="flex-1 flex flex-col gap-2">
                      <div>
                        <input
                          {...register(`values.${index}.title`)}
                          placeholder="Value title (e.g. Integrity)"
                          className={inputCls}
                        />
                        {errors.values?.[index]?.title && (
                          <p className="text-xs text-danger mt-1">
                            {errors.values[index]?.title?.message}
                          </p>
                        )}
                      </div>
                      <textarea
                        {...register(`values.${index}.description`)}
                        rows={2}
                        placeholder="What does this value mean in practice?"
                        className={textareaCls}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      className="text-text-muted hover:text-danger self-start p-1 rounded-xs transition-colors"
                      aria-label="Remove value"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {formError && (
              <p className="text-sm text-danger rounded-[8px] bg-danger-bg border border-danger-border px-4 py-3">
                {formError}
              </p>
            )}
          </div>

          <div className="px-5 pt-4 pb-12 border-t border-border-light flex gap-3">
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              Save
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </>,
    document.body,
  )
}
