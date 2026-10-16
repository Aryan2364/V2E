'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ChevronLeft } from 'lucide-react'
import { createGroup } from '@/lib/api/groups'
import Button from '@/components/ui/button'
import Card from '@/components/ui/card'

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  description: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

function Field({ label, error, required, children }: { label: string; error?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-text-secondary">
        {label}{required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}

const inputCls = (hasError?: boolean) =>
  [
    'w-full rounded-[8px] bg-white px-3 py-[10px] text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden transition-colors',
    hasError ? 'border-2 border-danger' : 'border border-border focus:border-2 focus:border-primary',
  ].join(' ')

export default function NewGroupPage() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (values: FormValues) => {
    setServerError(null)
    try {
      await createGroup(values)
      router.push('/super-admin/groups')
    } catch (err: any) {
      setServerError(err?.response?.data?.message ?? 'Something went wrong.')
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary mb-3 transition-colors"
        >
          <ChevronLeft size={16} /> Back
        </button>
        <h1 className="text-[28px] font-bold text-text-primary">Create Group</h1>
        <p className="text-sm text-text-secondary mt-1">Groups let you cluster related organizations and share users across them.</p>
      </div>

      {serverError && (
        <div className="rounded-[8px] bg-danger-bg border border-danger-border px-4 py-3 text-sm text-danger">
          {serverError}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
        <Card>
          <h2 className="text-[16px] font-semibold text-text-primary mb-5 pb-4 border-b border-border-light">Group Details</h2>
          <div className="flex flex-col gap-5">
            <Field label="Group Name" error={errors.name?.message} required>
              <input
                {...register('name')}
                placeholder="RGB Group"
                className={inputCls(!!errors.name)}
              />
            </Field>
            <Field label="Description" error={errors.description?.message}>
              <textarea
                {...register('description')}
                placeholder="Optional — describe what this group represents"
                rows={3}
                className={[inputCls(!!errors.description), 'resize-none'].join(' ')}
              />
            </Field>
          </div>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" isLoading={isSubmitting}>Create Group</Button>
          <Button type="button" variant="secondary" onClick={() => router.push('/super-admin/groups')} disabled={isSubmitting}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
