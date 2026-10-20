'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { isChanged, useUnsavedChanges, type UnsavedChangesMode } from '@/components/ui/unsaved-changes'

/**
 * Kit section 11.3 rule 10 for a form dialog: closing with unsaved changes
 * (Escape, the backdrop, the close button, Cancel, or a link elsewhere) asks
 * first, in the kit's own words.
 *
 *   const { warning, requestClose } = useGuardedClose({ open: isOpen, values: { title, date }, noun: 'meeting', onClose })
 *   <Modal onClose={requestClose}> ... <Button onClick={requestClose}>Cancel</Button> </Modal>
 *   {warning}
 *
 * `values` is every value the person can change. Without `saved`, "the
 * saved values" are what the form held just after it opened (a create form
 * or one prefilled from its props, after its own reset has run); pass
 * `saved` for an edit form whose values load after it opens. A form counts
 * as changed only when values differ from the saved ones, so typing and
 * deleting back asks nothing. After a successful save, call the plain
 * `onClose`, not `requestClose`.
 */
export function useGuardedClose({
  open,
  values,
  saved,
  noun,
  mode = 'create',
  onClose,
}: {
  open: boolean
  values: unknown
  saved?: unknown
  noun: string
  mode?: UnsavedChangesMode
  onClose: () => void
}) {
  const latest = useRef<unknown>(values)
  latest.current = values
  const [baseline, setBaseline] = useState<{ v: unknown } | null>(null)

  useEffect(() => {
    if (!open) { setBaseline(null); return }
    // After the form's own reset-on-open effects have settled.
    const t = setTimeout(() => setBaseline({ v: latest.current }), 0)
    return () => clearTimeout(t)
  }, [open])

  const changed =
    open && (saved !== undefined ? isChanged(values, saved) : baseline !== null && isChanged(values, baseline.v))
  const unsaved = useUnsavedChanges({ changed, noun, mode })

  const requestClose = useCallback(() => {
    unsaved.guard((next) => { if (!next) onClose() })(false)
  }, [unsaved, onClose])

  return { warning: unsaved.warning, requestClose, changed }
}
