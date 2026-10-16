'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { createKnowledgePost } from '@/lib/api/knowledge'
import Link from 'next/link'
import { ArrowLeft, X } from 'lucide-react'
import StyledSelect from '@/components/ui/StyledSelect'

export default function NewKnowledgePostPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const router = useRouter()
  const [form, setForm] = useState({ title: '', body: '', scope: 'company_wide', tagInput: '', tags: [] as string[] })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

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
    if (!orgId || !form.title.trim() || !form.body.trim()) {
      setErr('Title and body are required.')
      return
    }
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
      setErr('Failed to create post.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-sunken p-6">
      <div className="max-w-2xl mx-auto">
        <Link href="/communication/knowledge" className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-6 w-fit">
          <ArrowLeft size={16} />
          Back to Knowledge Hub
        </Link>

        <div className="bg-surface border border-border-light rounded-card p-6">
          <h1 className="text-xl font-medium text-text-primary mb-6">Share Knowledge</h1>

          {err && (
            <div className="mb-4 p-3 bg-danger-bg border border-danger-border rounded-control text-sm text-danger">
              {err}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Title</label>
              <input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="What are you sharing?"
                className="w-full border border-border rounded-control px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Content</label>
              <textarea
                value={form.body}
                onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                rows={8}
                placeholder="Share tips, processes, learnings, or anything useful…"
                className="w-full border border-border rounded-control px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary resize-y"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Tags</label>
              <div className="flex gap-2">
                <input
                  value={form.tagInput}
                  onChange={e => setForm(f => ({ ...f, tagInput: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                  placeholder="Add a tag and press Enter"
                  className="flex-1 border border-border rounded-control px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary"
                />
                <button type="button" onClick={addTag} className="bg-surface-control text-text-secondary px-3 py-2 rounded-control text-sm font-medium hover:bg-surface-control-pressed transition-colors">
                  Add
                </button>
              </div>
              {form.tags.length > 0 && (
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {form.tags.map(tag => (
                    <span key={tag} className="flex items-center gap-1 text-xs bg-primary-subtle text-primary-text px-2 py-0.5 rounded-full">
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)} className="hover:text-primary-text">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Scope</label>
              <StyledSelect
                value={form.scope}
                onChange={(v) => setForm(f => ({ ...f, scope: v }))}
                options={[
                  { value: 'company_wide', label: 'Company-wide' },
                  { value: 'department', label: 'Department' },
                ]}
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-primary text-primary-foreground px-4 py-2.5 rounded-control text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Publishing…' : 'Publish Post'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
