'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Target } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Tooltip from '@/components/ui/tooltip'
import DatePicker from '@/components/ui/DatePicker'
import EmployeePicker from '@/components/ui/EmployeePicker'
import { useToast } from '@/components/ui/Toast'
import { delegationsApi, type Delegation, type DelegationInput } from '@/lib/api/delegations'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useGuardedClose } from '@/lib/use-guarded-close'

// Base has NO width utility — callers add `w-full` (most fields) or a flex sizing
// (the criteria row) so `w-full` never fights `w-28`/`flex-1` and overflows the row.
const fieldBase =
  'border border-border rounded-[8px] px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary'
const inputClass = `w-full ${fieldBase}`
const labelClass = 'block text-body font-medium text-text-secondary mb-1'

interface EmployeeOption {
  user_id: string
  name: string
  role_title?: string | null
  department_name?: string | null
}
interface CriterionRow {
  description: string
  target: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
  orgId: string
  employees: EmployeeOption[]
  currentUser?: { user_id: string; name: string }
  /** When set, the modal edits this delegation instead of creating a new one. */
  existing?: Delegation | null
  onSaved: (d: Delegation) => void
}

const emptyRow = (): CriterionRow => ({ description: '', target: '' })

export default function DelegationModal({
  isOpen,
  onClose,
  orgId,
  employees,
  currentUser,
  existing,
  onSaved,
}: Props) {
  const { addToast } = useToast()
  const isEdit = !!existing

  const [title, setTitle] = useState('')
  const [outcome, setOutcome] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [kra, setKra] = useState('')
  const [runningBy, setRunningBy] = useState('')
  const [firstCheckIn, setFirstCheckIn] = useState('')
  const [criteria, setCriteria] = useState<CriterionRow[]>([emptyRow()])
  const [saving, setSaving] = useState(false)

  // (Re)seed the form whenever the modal opens or the target delegation changes.
  useEffect(() => {
    if (!isOpen) return
    setTitle(existing?.title ?? '')
    setOutcome(existing?.outcome ?? '')
    setOwnerId(existing?.owner_user_id ?? '')
    setKra(existing?.kra ?? '')
    setRunningBy(existing?.running_by ? existing.running_by.slice(0, 10) : '')
    setFirstCheckIn(existing?.first_check_in ? existing.first_check_in.slice(0, 10) : '')
    setCriteria(
      existing?.criteria?.length
        ? existing.criteria.map((c) => ({ description: c.description, target: c.target ?? '' }))
        : [emptyRow()],
    )
  }, [isOpen, existing])

  const ownerOptions = useMemo(() => employees.filter((e) => e.user_id && e.name), [employees])

  const patchRow = (i: number, patch: Partial<CriterionRow>) =>
    setCriteria((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  const canSubmit = title.trim() && outcome.trim() && ownerId
  const guarded = useGuardedClose({
    open: isOpen,
    values: { title, outcome, ownerId, kra, runningBy, firstCheckIn, criteria },
    noun: 'delegation',
    mode: isEdit ? 'edit' : 'create',
    onClose,
  })

  async function handleSubmit() {
    if (!canSubmit) {
      addToast('Fill in the title, outcome and owner first.', 'error')
      return
    }
    const payload: DelegationInput = {
      title: title.trim(),
      outcome: outcome.trim(),
      owner_user_id: ownerId,
      kra: kra.trim() || undefined,
      running_by: runningBy || undefined,
      first_check_in: firstCheckIn || undefined,
      criteria: criteria
        .map((c) => ({ description: c.description.trim(), target: c.target.trim() || undefined }))
        .filter((c) => c.description.length > 0),
    }
    setSaving(true)
    try {
      const saved = isEdit
        ? await delegationsApi.update(orgId, existing!.id, payload)
        : await delegationsApi.create(orgId, payload)
      addToast(isEdit ? 'Delegation saved' : 'Delegation added', 'success')
      onSaved(saved)
      onClose()
    } catch (err: any) {
      addToast(err?.response?.data?.message ?? 'Could not save the delegation. Try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
    {guarded.warning}
    <Modal isOpen={isOpen} onClose={guarded.requestClose} title={isEdit ? 'Edit delegation' : 'New delegation'} size="lg">
      <div className="flex flex-col gap-4">
        {/* Title */}
        <div>
          <Label className="mb-2" required>Title</Label>
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short name for this delegation"
            maxLength={200}
          />
        </div>

        {/* Outcome */}
        <div>
          <Label className="mb-2" required>Outcome</Label>
          <textarea
            className={`${inputClass} min-h-[72px] resize-y`}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder="What responsibility or result is being handed over?"
            maxLength={4000}
          />
        </div>

        {/* Owner + dates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="mb-2" required>Owner</Label>
            <EmployeePicker
              value={ownerId}
              onChange={setOwnerId}
              employees={ownerOptions}
              currentUser={currentUser}
              title="Select owner"
              placeholder="Who will own this?"
            />
          </div>
          <div>
            <Label className="mb-2">Fully running by</Label>
            <DatePicker value={runningBy} onChange={setRunningBy} placeholder="Handover target date" />
          </div>
        </div>

        {/* KRA (free text) + first check-in */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="mb-2">KRA</Label>
            <input
              className={inputClass}
              value={kra}
              onChange={(e) => setKra(e.target.value)}
              placeholder="Key result area this covers"
              maxLength={2000}
            />
          </div>
          <div>
            <Label className="mb-2">First check-in</Label>
            <DatePicker value={firstCheckIn} onChange={setFirstCheckIn} placeholder="First review date" />
            <p className="text-meta text-text-muted mt-1">A review task is created for you on this date.</p>
          </div>
        </div>

        {/* Measurable success criteria */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label className="gap-1.5">
              <Target size={14} className="text-primary-text" /> Success criteria
            </Label>
            <Tooltip label="Add criterion">
            <Button type="button" variant="secondary" size="icon" onClick={() => setCriteria((r) => [...r, emptyRow()])} aria-label="Add criterion">
              <Plus size={15} />
            </Button>
            </Tooltip>
          </div>
          <p className="text-meta text-text-muted mb-2">What does “done” look like — measurably?</p>
          <div className="flex flex-col gap-2">
            {criteria.map((row, i) => (
              <div key={i} className="flex items-start gap-2">
                <input
                  className={`${fieldBase} flex-1 min-w-0`}
                  value={row.description}
                  onChange={(e) => patchRow(i, { description: e.target.value })}
                  placeholder="What done looks like"
                  maxLength={500}
                />
                <input
                  className={`${fieldBase} w-28 shrink-0`}
                  value={row.target}
                  onChange={(e) => patchRow(i, { target: e.target.value })}
                  placeholder="Target"
                  maxLength={200}
                />
                <Tooltip label="Remove">
                <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => setCriteria((r) => (r.length > 1 ? r.filter((_, idx) => idx !== i) : [emptyRow()]))} aria-label="Remove">
                  <Trash2 size={15} />
                </Button>
                </Tooltip>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border-light">
          <Button type="button" variant="secondary" onClick={guarded.requestClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit || saving} loading={saving} loadingLabel="Saving">
            {isEdit ? 'Save delegation' : 'Add delegation'}
          </Button>
        </div>
      </div>
    </Modal>
    </>
  )
}
