'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Lock, ShieldCheck, ArrowRight } from 'lucide-react'
import { getAccessVisibility, type AccessVisibility } from '@/lib/api/permissions'
import { usePermissions } from '@/lib/auth/use-permissions'

/**
 * Shown wherever a module's main screen is empty BECAUSE of a permission gate, not
 * because there's no data. It self-fetches the visibility summary and explains, in
 * the user's terms, that data is assigned to them but hidden — plus the exact steps
 * to get access. Render it only when you already know the user is denied read
 * (e.g. `!can(leaf, 'read')`); it stays silent if the backend says they can read.
 */
export default function AccessHiddenState({
  orgId,
  leaf,
  moduleLabel,
}: {
  orgId: string
  leaf: string
  /** Fallback label shown before the summary loads (the API returns the real one). */
  moduleLabel?: string
}) {
  const { isAdmin } = usePermissions()
  const [vis, setVis] = useState<AccessVisibility | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId || !leaf) return
    let active = true
    setLoading(true)
    getAccessVisibility(orgId, leaf)
      .then((v) => active && setVis(v))
      .catch(() => active && setVis(null))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [orgId, leaf])

  // Backend says they can actually read — nothing to explain; let the caller's
  // normal empty state show instead.
  if (vis?.can_read) return null

  const label = vis?.module_label ?? moduleLabel ?? 'this module'
  const count = vis?.assigned_count ?? 0
  const reason = vis?.reason ?? 'role_lacks_permission'

  const lead =
    reason === 'no_system_role'
      ? `You haven't been assigned an access role yet, so ${label} — and most modules — stay hidden, even items that are yours.`
      : `Your access role doesn't include permission to view ${label}.`

  return (
    <div className="bg-white border border-border-light rounded-[12px] px-6 py-12 flex flex-col items-center text-center">
      <div className="w-14 h-14 rounded-[16px] bg-danger-bg flex items-center justify-center text-danger">
        <Lock size={26} />
      </div>

      <h3 className="text-[18px] font-semibold text-text-primary mt-4">You don&apos;t have access to {label}</h3>

      {count > 0 && (
        <p className="text-[15px] text-text-primary mt-2">
          <span className="font-semibold text-text-primary">
            {count} {count === 1 ? 'item is' : 'items are'}
          </span>{' '}
          assigned to you here, but hidden by your permissions.
        </p>
      )}

      <p className="text-sm text-text-secondary max-w-md mt-1.5">{lead}</p>

      {/* How to get access — concrete, followable steps */}
      <div className="w-full max-w-md mt-5 border border-border-light rounded-[10px] bg-surface-sunken p-4 text-left">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-text-primary mb-2">
          <ShieldCheck size={15} className="text-primary-text" />
          {isAdmin ? 'How to grant access' : 'How to get access'}
        </p>
        <ol className="flex flex-col gap-1.5 text-sm text-text-secondary list-decimal list-inside">
          {!isAdmin && (
            <li className="marker:text-text-muted">
              Ask an administrator to open{' '}
              <span className="font-medium text-text-primary">Settings → System Configuration → Access Rights</span>.
            </li>
          )}
          {isAdmin && (
            <li className="marker:text-text-muted">
              Open <span className="font-medium text-text-primary">Access Rights → Roles &amp; Permissions</span>.
            </li>
          )}
          <li className="marker:text-text-muted">
            Pick a role (or create one) and enable{' '}
            <span className="font-medium text-text-primary">{label} → View</span> (set the Data Scope: Own / My Team /
            Company).
          </li>
          <li className="marker:text-text-muted">
            {reason === 'no_system_role'
              ? 'Assign that role to the user'
              : 'Make sure your role has it enabled'}
            {' '}— or grant just one person via their profile&apos;s{' '}
            <span className="font-medium text-text-primary">Access &amp; Permissions → {label} → Read → Grant</span>.
          </li>
        </ol>
      </div>

      {isAdmin ? (
        <Link
          href="/settings/system/access-rights"
          className="inline-flex items-center gap-1.5 mt-5 px-4 py-2.5 text-sm font-semibold text-white bg-primary hover:bg-primary-hover rounded-[8px]"
        >
          Open Access Rights <ArrowRight size={15} />
        </Link>
      ) : (
        <p className="text-xs text-text-muted mt-5">
          {loading ? 'Checking your access…' : 'Contact your administrator to be granted access.'}
        </p>
      )}
    </div>
  )
}
