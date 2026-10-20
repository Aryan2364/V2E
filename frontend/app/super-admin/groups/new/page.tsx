'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { OctagonXIcon } from 'lucide-react'
import { createGroup } from '@/lib/api/groups'
import { Button } from '@/components/ui/button'
import Card from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { Banner, BannerDescription } from '@/components/ui/banner'
import { PageHeader } from '@/components/shell/page-header'

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  description: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

function Field({ label, error, required, children }: { label: string; error?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <Label required={required}>{label}</Label>
      <div className="mt-2">{children}</div>
      <InlineFieldError>{error}</InlineFieldError>
    </div>
  )
}

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
    <div className="max-w-2xl">
      <PageHeader
        title="Create Group"
        meta="Groups let you cluster related organizations and share users across them."
        trail={[
          { label: 'Groups', href: '/super-admin/groups' },
          { label: 'Create', href: '/super-admin/groups/new' },
        ]}
      />

      <div className="mt-6 flex flex-col gap-6">
        {serverError ? (
          <Banner variant="danger">
            <OctagonXIcon />
            <BannerDescription>{serverError}</BannerDescription>
          </Banner>
        ) : null}

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
          <Card>
            <h2 className="mb-4 border-b border-border-light pb-4 text-card-heading font-medium text-text-primary">
              Group Details
            </h2>
            <div className="flex flex-col gap-4">
              <Field label="Group Name" error={errors.name?.message} required>
                <Input {...register('name')} placeholder="RGB Group" className="max-w-none" />
              </Field>
              <Field label="Description" error={errors.description?.message}>
                <Textarea
                  {...register('description')}
                  placeholder="Optional — describe what this group represents"
                  rows={3}
                />
              </Field>
            </div>
          </Card>

          <div className="flex items-center gap-3">
            <Button type="submit" loading={isSubmitting} loadingLabel="Creating">Create group</Button>
            <Button type="button" variant="secondary" onClick={() => router.push('/super-admin/groups')} disabled={isSubmitting}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
