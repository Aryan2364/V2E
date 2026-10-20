'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { createAnnouncement, publishAnnouncement } from '@/lib/api/announcements'
import DatePicker from '@/components/ui/DatePicker'
import StyledSelect from '@/components/ui/StyledSelect'
import { PageHeader } from '@/components/shell/page-header'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Banner, BannerDescription } from '@/components/ui/banner'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { useUnsavedChanges } from '@/components/ui/unsaved-changes'

export default function NewAnnouncementPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const router = useRouter()
  const [form, setForm] = useState({
    title: '',
    body: '',
    type: 'general',
    priority: 'normal',
    scope: 'company_wide',
    expires_at: '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; body?: string }>({})
  // A new announcement exists only once saved: leaving a filled-in form asks first (kit 11.3 rule 10).
  const unsaved = useUnsavedChanges({
    changed: !saving && (form.title.trim() !== '' || form.body.trim() !== '' || form.expires_at !== ''),
    noun: 'announcement',
    mode: 'create',
  })

  function set(k: string, v: string) {
    setForm(f => ({ ...f, [k]: v }))
  }

  async function handleSubmit(publish: boolean) {
    if (!orgId) return
    if (!form.title.trim() || !form.body.trim()) {
      setFieldErrors({
        title: form.title.trim() ? undefined : 'Enter a title for the announcement.',
        body: form.body.trim() ? undefined : 'Write the announcement text.',
      })
      requestAnimationFrame(() => document.getElementById(form.title.trim() ? 'announcement-body' : 'announcement-title')?.focus())
      return
    }
    setFieldErrors({})
    setSaving(true)
    setErr('')
    try {
      const ann = await createAnnouncement(orgId, {
        title: form.title.trim(),
        body: form.body.trim(),
        type: form.type as any,
        priority: form.priority as any,
        scope: form.scope as any,
        expires_at: form.expires_at || undefined,
      } as any)
      if (publish) await publishAnnouncement(orgId, ann.id)
      router.push('/communication/announcements')
    } catch {
      setErr('Could not save the announcement. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-sunken p-6">
      {unsaved.warning}
      <div className="max-w-2xl mx-auto">
        <PageHeader title="New announcement" trail={[{ label: 'Announcements', href: '/communication/announcements' }]} />
        <div className="bg-surface border border-border-light rounded-card p-6">
          {err && (
            <Banner variant="danger" className="mb-4">
              <BannerDescription>{err}</BannerDescription>
            </Banner>
          )}

          <div className="flex flex-col gap-4">
            <div>
              <Label className="mb-2" htmlFor="announcement-title" required>Title</Label>
              <input
                id="announcement-title"
                value={form.title}
                onChange={e => { set('title', e.target.value); setFieldErrors((p) => (p.title ? { ...p, title: undefined } : p)) }}
                placeholder="For example, Office closed on Diwali"
                aria-invalid={fieldErrors.title ? true : undefined}
                className="w-full max-w-[480px] border border-border rounded-control px-3 py-2 text-label text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary aria-invalid:border-danger"
              />
              <InlineFieldError>{fieldErrors.title}</InlineFieldError>
            </div>

            <div>
              <Label className="mb-2" htmlFor="announcement-body" required>Body</Label>
              <Textarea
                id="announcement-body"
                value={form.body}
                onChange={e => { set('body', e.target.value); setFieldErrors((p) => (p.body ? { ...p, body: undefined } : p)) }}
                rows={6}
                aria-invalid={fieldErrors.body ? true : undefined}
              />
              <InlineFieldError>{fieldErrors.body}</InlineFieldError>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="mb-2">Type</Label>
                <StyledSelect
                  value={form.type}
                  onChange={(v) => set('type', v)}
                  options={['general', 'policy', 'event', 'emergency'].map((t) => ({
                    value: t,
                    label: t.charAt(0).toUpperCase() + t.slice(1),
                  }))}
                />
              </div>
              <div>
                <Label className="mb-2">Priority</Label>
                <StyledSelect
                  value={form.priority}
                  onChange={(v) => set('priority', v)}
                  options={['normal', 'high', 'urgent'].map((p) => ({
                    value: p,
                    label: p.charAt(0).toUpperCase() + p.slice(1),
                  }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="mb-2">Scope</Label>
                <StyledSelect
                  value={form.scope}
                  onChange={(v) => set('scope', v)}
                  options={[
                    { value: 'company_wide', label: 'Company-wide' },
                    { value: 'department', label: 'Department' },
                  ]}
                />
              </div>
              <div>
                <Label className="mb-2">Expires on</Label>
                <DatePicker
                  value={form.expires_at}
                  onChange={(iso) => set('expires_at', iso)}
                  placeholder="Select date"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" data-leaves-page onClick={() => router.push('/communication/announcements')} disabled={saving}>
                Cancel
              </Button>
              <Button variant="secondary" onClick={() => handleSubmit(false)} disabled={saving}>
                Save draft
              </Button>
              <Button onClick={() => handleSubmit(true)} disabled={saving} loading={saving} loadingLabel="Publishing">
                Publish announcement
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
