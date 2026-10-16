'use client'

import { useState } from 'react'
import { SlidersHorizontal, ChevronDown } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
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
        <Switch checked={proofRequired} onCheckedChange={onProofRequiredChange} />
        <span className="text-body text-text-primary font-medium">Proof of completion required</span>

        {proofRequired && (
          <button
            type="button"
            onClick={() => setShowTypes((v) => !v)}
            className="ml-auto inline-flex items-center gap-1.5 text-meta font-medium text-text-secondary hover:text-primary-text transition-colors"
            aria-expanded={showTypes}
          >
            <SlidersHorizontal size={13} />
            {allOn ? 'Any file type' : `${selected.size} type${selected.size !== 1 ? 's' : ''}`}
            <ChevronDown size={13} className={showTypes ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </button>
        )}
      </div>

      {proofRequired && showTypes && (
        <div className="mt-2 rounded-lg border border-border-light bg-surface-sunken p-3">
          <p className="text-meta font-medium text-text-muted uppercase tracking-wide mb-2">Allowed proof types</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {FILE_TYPE_GROUPS.map((g) => (
              <label key={g.key} className="flex items-center gap-2 text-label text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-primary w-4 h-4"
                  checked={selected.has(g.key)}
                  onChange={() => toggleGroup(g.key)}
                />
                {g.label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-meta text-text-muted">All types on = anything accepted. At least one must stay on.</p>
        </div>
      )}
    </div>
  )
}
