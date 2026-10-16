'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, ArrowRight, LogOut } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import type { OrgChoice } from '@/lib/types'
import { useLayout } from '@/lib/layout'
import { signedInHome } from '@/lib/phone-routes'

const ADMIN_BADGE = 'bg-success-bg text-success border border-success-border'
const MEMBER_BADGE = 'bg-surface-control text-text-secondary border border-border-light'

export default function SelectOrgPage() {
  const { pendingOrgSelection, selectOrg, logout, user } = useAuth()
  const router = useRouter()
  const { layout } = useLayout()
  const [selecting, setSelecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Redirect if already authenticated or no pending orgs
  useEffect(() => {
    if (user) {
      // Desktop: unchanged. Phone: My work, the phone's home (lib/phone-routes.ts).
      router.replace(signedInHome(user, layout))
    }
  }, [user, router, layout])

  // If there are no pending orgs and no user, go to login.
  // Guard against the moment a selection succeeds: selectOrg() sets `user`,
  // clears pendingOrgSelection AND removes the selection_token — without these
  // guards this effect would race the "go to dashboard" effect and bounce
  // through the login form.
  useEffect(() => {
    if (user || selecting) return
    if (!pendingOrgSelection) {
      const token = typeof window !== 'undefined' ? localStorage.getItem('selection_token') : null
      if (!token) router.replace('/login')
    }
  }, [pendingOrgSelection, user, selecting, router])

  const orgs: OrgChoice[] = pendingOrgSelection ?? []

  const filtered = search.trim()
    ? orgs.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()))
    : orgs

  // While a firm is being entered (or the session is already established and the
  // dashboard redirect is in flight), show a single clean loading screen instead
  // of re-rendering the cards or flashing other auth pages.
  if (selecting || user) {
    return (
      <div className="min-h-screen bg-surface-sunken flex flex-col items-center justify-center gap-4">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-text-secondary">Entering your workspace…</p>
      </div>
    )
  }

  async function handleSelect(orgId: string) {
    setSelecting(orgId)
    setError(null)
    try {
      await selectOrg(orgId)
    } catch {
      setError('Failed to switch organization. Please try again.')
      setSelecting(null)
    }
  }

  return (
    <div className="min-h-screen bg-surface-sunken flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[640px]">
        {/* Header */}
        <div className="text-center mb-10">
          <span className="text-[28px] font-bold text-text-primary tracking-tight">V2E</span>
          <h1 className="mt-4 text-[22px] font-semibold text-text-primary">Select an Organization</h1>
          <p className="mt-1 text-[15px] text-text-secondary">
            You belong to multiple organizations. Choose one to enter.
          </p>
        </div>

        {/* Search (show when > 5 orgs) */}
        {orgs.length > 5 && (
          <div className="mb-6">
            <input
              type="text"
              placeholder="Search organizations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-[44px] px-4 text-[15px] text-text-primary placeholder-text-muted bg-white border border-border rounded-[8px] focus:outline-hidden focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-[8px] border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        {/* Org Cards */}
        <div className="flex flex-col gap-3">
          {filtered.map((org) => {
            const isSelecting = selecting === org.id
            return (
              <button
                key={org.id}
                onClick={() => handleSelect(org.id)}
                disabled={!!selecting}
                className="group w-full flex items-center gap-4 p-5 bg-white border border-border-light rounded-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] hover:border-primary hover:shadow-[0_2px_8px_rgba(37,99,235,0.12)] transition-all duration-150 text-left disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {/* Org icon */}
                <div className="w-12 h-12 rounded-[10px] bg-primary-subtle flex items-center justify-center shrink-0 group-hover:bg-primary-subtle transition-colors">
                  {org.logo_url ? (
                    <img src={org.logo_url} alt={org.name} className="w-8 h-8 object-contain rounded-xs" />
                  ) : (
                    <Building2 size={22} className="text-primary-text" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-semibold text-text-primary truncate">{org.name}</p>
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium ${org.is_admin ? ADMIN_BADGE : MEMBER_BADGE}`}>
                      {org.is_admin ? 'Administrator' : 'Member'}
                    </span>
                    <span className="text-[13px] text-text-muted">
                      Since {new Date(org.joined_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                </div>

                {/* Arrow */}
                <div className="shrink-0 text-text-muted group-hover:text-primary-text transition-colors">
                  {isSelecting ? (
                    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <ArrowRight size={20} />
                  )}
                </div>
              </button>
            )
          })}

          {filtered.length === 0 && (
            <div className="text-center py-12 text-text-secondary">No organizations match your search.</div>
          )}
        </div>

        {/* Sign out link */}
        <div className="mt-8 text-center">
          <button
            onClick={logout}
            className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
