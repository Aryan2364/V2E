'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/context'
import { createKnowledgePost } from '@/lib/api/knowledge'
import Link from 'next/link'
import { ArrowLeft, X } from 'lucide-react'

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
    <div className="min-h-screen bg-[#F8FAFC] p-6">
      <div className="max-w-2xl mx-auto">
        <Link href="/communication/knowledge" className="flex items-center gap-2 text-sm text-[#475569] hover:text-[#0F172A] mb-6 w-fit">
          <ArrowLeft size={16} />
          Back to Knowledge Hub
        </Link>

        <div className="bg-white border border-[#E2E8F0] rounded-[12px] p-6">
          <h1 className="text-xl font-bold text-[#0F172A] mb-6">Share Knowledge</h1>

          {err && (
            <div className="mb-4 p-3 bg-[#FEF2F2] border border-[#FECACA] rounded-[8px] text-sm text-[#DC2626]">
              {err}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1">Title</label>
              <input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="What are you sharing?"
                className="w-full border border-[#CBD5E1] rounded-[8px] px-3 py-2 text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-hidden focus:border-[#2563EB]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1">Content</label>
              <textarea
                value={form.body}
                onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                rows={8}
                placeholder="Share tips, processes, learnings, or anything useful…"
                className="w-full border border-[#CBD5E1] rounded-[8px] px-3 py-2 text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-hidden focus:border-[#2563EB] resize-y"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1">Tags</label>
              <div className="flex gap-2">
                <input
                  value={form.tagInput}
                  onChange={e => setForm(f => ({ ...f, tagInput: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                  placeholder="Add a tag and press Enter"
                  className="flex-1 border border-[#CBD5E1] rounded-[8px] px-3 py-2 text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-hidden focus:border-[#2563EB]"
                />
                <button type="button" onClick={addTag} className="bg-[#F1F5F9] text-[#475569] px-3 py-2 rounded-[8px] text-sm font-medium hover:bg-[#E2E8F0] transition-colors">
                  Add
                </button>
              </div>
              {form.tags.length > 0 && (
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {form.tags.map(tag => (
                    <span key={tag} className="flex items-center gap-1 text-xs bg-[#EFF6FF] text-[#2563EB] px-2 py-0.5 rounded-full">
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)} className="hover:text-[#1D4ED8]">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1">Scope</label>
              <select
                value={form.scope}
                onChange={e => setForm(f => ({ ...f, scope: e.target.value }))}
                className="w-full border border-[#CBD5E1] rounded-[8px] px-3 py-2 text-sm text-[#0F172A] focus:outline-hidden focus:border-[#2563EB]"
              >
                <option value="company_wide">Company-wide</option>
                <option value="department">Department</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-[#2563EB] text-white px-4 py-2.5 rounded-[8px] text-sm font-semibold hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Publishing…' : 'Publish Post'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
