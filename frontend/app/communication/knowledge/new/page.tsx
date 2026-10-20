'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { createKnowledgePost } from '@/lib/api/knowledge'
import Link from 'next/link'
import { X } from 'lucide-react'
import { PageHeader } from '@/components/shell/page-header'
import StyledSelect from '@/components/ui/StyledSelect'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { InlineFieldError } from '@/components/ui/inline-field-error'
import { useUnsavedChanges } from '@/components/ui/unsaved-changes'

export default function NewKnowledgePostPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const router = useRouter()
  const [form, setForm] = useState({ title: '', body: '', scope: 'company_wide', tagInput: '', tags: [] as string[] })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; body?: string }>({})
  // A new post exists only once published: leaving a filled-in form asks first (kit 11.3 rule 10).
  const unsaved = useUnsavedChanges({
    changed: !saving && (form.title.trim() !== '' || form.body.trim() !== '' || form.tags.length > 0),
    noun: 'post',
    mode: 'create',
  })

  function addTag() {
    const tag = form.tagInput.trim().toLowerCase()
    if (tag && !form.tags.includes(tag)) {
      setForm(f => ({ ...f, tags: [...f.tags, tag], tagInput: '' }))
    }
  }

  function removeTag(tag: string) {
    setForm(f => ({ ...f, tags: f.tags.filter(t => t !== tag) }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId) return
    if (!form.title.trim() || !form.body.trim()) {
      setFieldErrors({
        title: form.title.trim() ? undefined : 'Enter a title for the post.',
        body: form.body.trim() ? undefined : 'Write the content of the post.',
      })
      requestAnimationFrame(() => document.getElementById(form.title.trim() ? 'knowledge-body' : 'knowledge-title')?.focus())
      return
    }
    setFieldErrors({})
    setSaving(true)
    setErr('')
    try {
      await createKnowledgePost(orgId, {
        title: form.title.trim(),
        body: form.body.trim(),
        scope: form.scope as any,
        tags: form.tags as any,
      } as any)
      router.push('/communication/knowledge')
    } catch {
      setErr('Could not publish the post. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-sunken p-6">
      {unsaved.warning}
      <div className="max-w-2xl mx-auto">
        <PageHeader title="Share knowledge" trail={[{ label: 'Knowledge hub', href: '/communication/knowledge' }]} />

        <div className="bg-surface border border-border-light rounded-card p-6">
          {err && (
            <div className="mb-4 p-3 bg-danger-bg border border-danger-border rounded-control text-label text-danger">
              {err}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <Label className="mb-2" htmlFor="knowledge-title" required>Title</Label>
              <input
                id="knowledge-title"
                value={form.title}
                onChange={e => { setForm(f => ({ ...f, title: e.target.value })); setFieldErrors((p) => (p.title ? { ...p, title: undefined } : p)) }}
                placeholder="For example, How we onboard a new dealer"
                aria-invalid={fieldErrors.title ? true : undefined}
                className="w-full max-w-[480px] border border-border rounded-control px-3 py-2 text-label text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary aria-invalid:border-danger"
              />
              <InlineFieldError>{fieldErrors.title}</InlineFieldError>
            </div>

            <div>
              <Label className="mb-2" htmlFor="knowledge-body" required>Content</Label>
              <textarea
                id="knowledge-body"
                value={form.body}
                onChange={e => { setForm(f => ({ ...f, body: e.target.value })); setFieldErrors((p) => (p.body ? { ...p, body: undefined } : p)) }}
                rows={8}
                aria-invalid={fieldErrors.body ? true : undefined}
                className="w-full border border-border rounded-control px-3 py-2 text-label text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary resize-y aria-invalid:border-danger"
              />
              <InlineFieldError>{fieldErrors.body}</InlineFieldError>
            </div>

            <div>
              <Label className="mb-2">Tags</Label>
              <div className="flex gap-2">
                <input
                  value={form.tagInput}
                  onChange={e => setForm(f => ({ ...f, tagInput: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                  placeholder="For example, onboarding"
                  className="flex-1 border border-border rounded-control px-3 py-2 text-label text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary"
                />
                <Button type="button" variant="secondary" onClick={addTag}>
                  Add
                </Button>
              </div>
              {form.tags.length > 0 && (
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {form.tags.map(tag => (
                    <span key={tag} className="flex items-center gap-1 text-meta bg-primary-subtle text-primary-text px-2 py-0.5 rounded-full">
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove tag ${tag}`} className="rounded-xs hover:text-primary-text outline-none focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-primary-ring ">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Label className="mb-2">Scope</Label>
              <StyledSelect
                value={form.scope}
                onChange={(v) => setForm(f => ({ ...f, scope: v }))}
                options={[
                  { value: 'company_wide', label: 'Company-wide' },
                  { value: 'department', label: 'Department' },
                ]}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" data-leaves-page onClick={() => router.push('/communication/knowledge')} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving} loading={saving} loadingLabel="Publishing">
                Publish post
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
