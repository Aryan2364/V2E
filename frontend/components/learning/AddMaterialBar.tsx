'use client'

import { useRef, useState } from 'react'
import { Upload, Link2, FileText, Loader2 } from 'lucide-react'
import { ACCEPT_ATTR, validateFile } from '@/lib/attachments'
import type { ContentType } from '@/lib/types/learning'
import { Button } from '@/components/ui/button'

/**
 * The four ways to add a material, as one inline toolbar (not a separate page).
 * "Upload file" creates a file item then uploads the picked file; the others
 * create an empty item of that type for inline editing in the row. The parent
 * owns item creation + upload (it has orgId + the draft path); this bar just
 * validates the pick and drives the busy/error UI.
 */
export default function AddMaterialBar({
  onAdd,
}: {
  onAdd: (type: ContentType, files?: File[]) => Promise<void>
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<ContentType | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function run(type: ContentType, files?: File[]) {
    let accepted = files
    if (type === 'file' && files?.length) {
      // Add every valid file; skip only the invalid ones and name them so the user
      // knows exactly what didn't go in (never reject the whole pick).
      accepted = []
      const rejected: string[] = []
      for (const f of files) {
        const bad = validateFile(f)
        if (bad) rejected.push(`${f.name} — ${bad}`)
        else accepted.push(f)
      }
      setErr(rejected.length ? `Skipped: ${rejected.join('; ')}` : null)
      if (accepted.length === 0) return
    } else {
      setErr(null)
    }
    setBusy(type)
    try {
      await onAdd(type, accepted)
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? e?.message ?? 'Something went wrong. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!!busy} onClick={() => fileInput.current?.click()}>
          {busy === 'file' ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          Upload files
        </Button>
        <Button type="button" variant="secondary" disabled={!!busy} onClick={() => run('url')}>
          <Link2 size={15} /> Add link
        </Button>
        <Button type="button" variant="secondary" disabled={!!busy} onClick={() => run('article')}>
          <FileText size={15} /> Write article
        </Button>
      </div>
      <p className="text-meta text-text-secondary mt-2">
        Pick one or several files at once — each becomes its own material. PDF, images and video/audio play in-app · up to 25 MB each. For slides, export PowerPoint to PDF so it plays in-app (Office files upload but open by download).
      </p>
      {err && <p className="text-meta text-danger mt-1">{err}</p>}
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        className="hidden"
        onChange={(e) => { run('file', e.target.files ? Array.from(e.target.files) : undefined); e.target.value = '' }}
      />
    </div>
  )
}
