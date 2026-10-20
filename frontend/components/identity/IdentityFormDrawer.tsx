'use client'

import { useEffect, useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { upsertOrgIdentity } from '@/lib/api/org-identity'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { useUnsavedChanges } from '@/components/ui/unsaved-changes'
import { Banner, BannerDescription } from '@/components/ui/banner'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  SheetFooter,
} from '@/components/ui/sheet'
import { OctagonXIcon } from 'lucide-react'
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
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: { values: [] },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'values' })

  // Leaving with unsaved changes asks first (kit 11.3 rule 10).
  const unsaved = useUnsavedChanges({ changed: open && isDirty && !isSubmitting, noun: 'identity', mode: 'edit' })
  const requestClose = () => unsaved.guard((next) => { if (!next) onClose() })(false)

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
      setFormError(Array.isArray(raw) ? raw[0] : raw ?? 'Could not save the identity. Try again.')
    }
  }

  return (
    <>
    {unsaved.warning}
    <Sheet open={open} onOpenChange={(next) => { if (!next) requestClose() }}>
      <SheetContent side="right" className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Edit organization identity</SheetTitle>
        </SheetHeader>

        <form id="identity-form" onSubmit={handleSubmit(onSubmit)} className="contents">
          <SheetBody className="flex flex-col gap-6">
            {/* Core pillars */}
            <div className="flex flex-col gap-6">
              <div>
                <Label htmlFor="identity-vision">Vision</Label>
                <Textarea
                  id="identity-vision"
                  {...register('vision')}
                  rows={3}
                  placeholder="What future are you working toward?"
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="identity-mission">Mission</Label>
                <Textarea
                  id="identity-mission"
                  {...register('mission')}
                  rows={3}
                  placeholder="What does your organization do, for whom, and why?"
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="identity-purpose">Purpose</Label>
                <Textarea
                  id="identity-purpose"
                  {...register('purpose')}
                  rows={3}
                  placeholder="Beyond profit, why does your organization exist?"
                  className="mt-2"
                />
              </div>
            </div>

            {/* Values */}
            <div className="rounded-lg border border-border-light bg-surface-sunken p-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-body font-medium text-text-primary">Organisational values</h4>
                <Button
                  type="button"
                  onClick={() => append({ title: '', description: '' })}
                  variant="secondary"
                  size="sm"
                >
                  <PlusIcon size={13} /> Add value
                </Button>
              </div>
              <div className="flex max-h-85 flex-col gap-3 overflow-y-auto pr-1">
                {fields.length === 0 && (
                  <p className="py-3 text-center text-label text-text-muted">No values added yet.</p>
                )}
                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="flex gap-3 rounded-lg border border-border-light bg-surface p-3"
                  >
                    <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-label font-medium text-primary-foreground">
                      {index + 1}
                    </div>
                    <div className="flex flex-1 flex-col gap-2">
                      <div>
                        <Input
                          {...register(`values.${index}.title`)}
                          aria-label="Value title" placeholder="For example, Integrity"
                          className="max-w-none"
                        />
                        <InlineFieldError>{errors.values?.[index]?.title?.message}</InlineFieldError>
                      </div>
                      <Textarea
                        {...register(`values.${index}.description`)}
                        rows={2}
                        aria-label="Value description" placeholder="For example, We do what we say we will do"
                      />
                    </div>
                    <Button
                      type="button"
                      onClick={() => remove(index)}
                      aria-label="Remove value"
                      variant="ghost"
                      size="icon"
                    >
                      <Trash2Icon size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {formError ? (
              <Banner variant="danger">
                <OctagonXIcon />
                <BannerDescription>{formError}</BannerDescription>
              </Banner>
            ) : null}
          </SheetBody>
        </form>

        <SheetFooter>
          <Button type="button" variant="secondary" onClick={requestClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="identity-form" loading={isSubmitting} loadingLabel="Saving">
            Save identity
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
    </>
  )
}
