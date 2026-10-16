'use client'

import { useState } from 'react'
import { SlidersHorizontal, ChevronDown } from 'lucide-react'
import {
  FILE_TYPE_GROUPS,
  groupsFromExtensions,
  extensionsFromGroups,
} from '@/lib/attachments'

interface Props {
  proofRequired: boolean
  onProofRequiredChange: (v: boolean) => void
  /** Stored allowed extensions (empty = anything). Managed as broad groups in the UI. */
  allowedExtensions: string[]
  onAllowedExtensionsChange: (exts: string[]) => void
}

/**
 * "Proof of completion required" switch. When on, a gear reveals an in-flow panel of
 * broad file-type groups (Images / PDF / …) restricting what counts as proof — all on
 * (the default) means anything is accepted. Shared by Create/Edit task modals.
 */
export default function ProofRequirementField({
  proofRequired,
  onProofRequiredChange,
  allowedExtensions,
  onAllowedExtensionsChange,
}: Props) {
  const [showTypes, setShowTypes] = useState(false)
  const selected = groupsFromExtensions(allowedExtensions)

  const toggleGroup = (key: string) => {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    // Never allow zero groups — that would make proof impossible to satisfy.
    if (next.size === 0) return
    onAllowedExtensionsChange(extensionsFromGroups(next))
  }

  const allOn = selected.size === FILE_TYPE_GROUPS.length

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onProofRequiredChange(!proofRequired)}
          className={[
            'relative w-10 h-5 rounded-full transition-colors duration-200',
            proofRequired ? 'bg-[#2563EB]' : 'bg-[#CBD5E1]',
          ].join(' ')}
          role="switch"
          aria-checked={proofRequired}
        >
          <span
            className={[
              'absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200',
              proofRequired ? 'translate-x-5' : 'translate-x-0',
            ].join(' ')}
          />
        </button>
        <span className="text-sm text-[#1E293B] font-medium">Proof of completion required</span>

        {proofRequired && (
          <button
            type="button"
            onClick={() => setShowTypes((v) => !v)}
            className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-medium text-[#475569] hover:text-[#2563EB] transition-colors"
            aria-expanded={showTypes}
          >
            <SlidersHorizontal size={13} />
            {allOn ? 'Any file type' : `${selected.size} type${selected.size !== 1 ? 's' : ''}`}
            <ChevronDown size={13} className={showTypes ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </button>
        )}
      </div>

      {proofRequired && showTypes && (
        <div className="mt-2 rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] p-3">
          <p className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wide mb-2">Allowed proof types</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {FILE_TYPE_GROUPS.map((g) => (
              <label key={g.key} className="flex items-center gap-2 text-sm text-[#334155] cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-[#2563EB] w-4 h-4"
                  checked={selected.has(g.key)}
                  onChange={() => toggleGroup(g.key)}
                />
                {g.label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[#64748B]">All types on = anything accepted. At least one must stay on.</p>
        </div>
      )}
    </div>
  )
}
