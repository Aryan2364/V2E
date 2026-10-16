'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { createAnnouncement, publishAnnouncement } from '@/lib/api/announcements'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import StyledSelect from '@/components/ui/StyledSelect'

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

  function set(k: string, v: string) {
    setForm(f => ({ ...f, [k]: v }))
  }

  async function handleSubmit(publish: boolean) {
    if (!orgId) return
    if (!form.title.trim() || !form.body.trim()) {
      setErr('Title and body are required.')
      return
    }
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
      setErr('Failed to create announcement.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-sunken p-6">
      <div className="max-w-2xl mx-auto">
        <Link
          href="/communication/announcements"
          className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-6 w-fit"
        >
          <ArrowLeft size={16} />
          Back to Announcements
        </Link>
        <div className="bg-surface border border-border-light rounded-card p-6">
          <h1 className="text-xl font-medium text-text-primary mb-6">New Announcement</h1>

          {err && (
            <div className="mb-4 p-3 bg-danger-bg border border-danger-border rounded-control text-sm text-danger">
              {err}
            </div>
          )}

          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Title</label>
              <input
                value={form.title}
                onChange={e => set('title', e.target.value)}
                placeholder="Announcement title"
                className="w-full border border-border rounded-control px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Body</label>
              <textarea
                value={form.body}
                onChange={e => set('body', e.target.value)}
                rows={6}
                placeholder="Write your announcement..."
                className="w-full border border-border rounded-control px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary resize-y"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Type</label>
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
                <label className="block text-sm font-medium text-text-secondary mb-1">Priority</label>
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
                <label className="block text-sm font-medium text-text-secondary mb-1">Scope</label>
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
                <label className="block text-sm font-medium text-text-secondary mb-1">Expires At (optional)</label>
                <DatePicker
                  value={form.expires_at}
                  onChange={(iso) => set('expires_at', iso)}
                  placeholder="Select date"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => handleSubmit(false)}
                disabled={saving}
                className="flex-1 bg-surface border-2 border-primary text-primary-text px-4 py-2.5 rounded-control text-sm font-medium hover:bg-primary-subtle disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Save Draft
              </button>
              <button
                onClick={() => handleSubmit(true)}
                disabled={saving}
                className="flex-1 bg-primary text-primary-foreground px-4 py-2.5 rounded-control text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? 'Publishing…' : 'Publish Now'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
