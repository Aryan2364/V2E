'use client'

import React from 'react'
import { StickyNote } from 'lucide-react'
import type { InstanceNote } from '@/lib/types/workflows'
import { Avatar, fmtDateTime } from './shared'

/** One message left for a step ("For <step>" in the instance discussion): who, when, the text. */
export function NoteItem({ note }: { note: InstanceNote }) {
  return (
    <li className="flex items-start gap-2.5">
      <Avatar name={note.author?.name || '?'} size="md" />
      <div className="min-w-0 flex-1 rounded-[10px] bg-[#FFFBEB] border border-[#FDE68A] px-3 py-2">
        <p className="min-w-0 text-[13px]">
          <span className="font-semibold text-[#0F172A]">{note.author?.name || 'Someone'}</span>
          <span className="text-[#475569]"> · {fmtDateTime(note.created_at)}</span>
        </p>
        <p className="mt-1 text-sm text-[#1E293B] whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{note.body}</p>
      </div>
    </li>
  )
}

/**
 * "Notes for this step": messages of the instance discussion tagged for this step, newest
 * first — on the step's task (banner) and in its panel on the instance page.
 */
export default function StepNotes({ notes, headingId, className = '' }: { notes: InstanceNote[]; headingId: string; className?: string }) {
  if (!notes.length) return null
  const list = notes.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))
  return (
    <section aria-labelledby={headingId} className={`flex flex-col gap-2 ${className}`}>
      <h3 id={headingId} className="flex items-center gap-1.5 text-sm font-semibold text-[#0F172A]">
        <StickyNote size={15} className="text-[#92400E]" /> Notes for this step
      </h3>
      <ul className="flex flex-col gap-2">
        {list.map((n) => (
          <NoteItem key={n.id} note={n} />
        ))}
      </ul>
    </section>
  )
}
