'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Building2Icon, ArrowRightIcon, LogOutIcon } from 'lucide-react'
import { useAuth } from '@/lib/auth/context'
import type { OrgChoice } from '@/lib/types'
import { useLayout } from '@/lib/layout'
import { signedInHome } from '@/lib/phone-routes'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Banner, BannerDescription } from '@/components/ui/banner'
import { BrandGlyph } from '@/components/ui/BrandMark'
import { formatDate } from '@/lib/format'
import { OctagonXIcon } from 'lucide-react'

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
  // dashboard redirect is in flight), show nothing rather than a spinner
  // (section 14 rule 1) so the cards never flash back in before navigating away.
  if (selecting || user) {
    return null
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-sunken px-4 py-12">
      <div className="w-full max-w-160">
        {/* Header */}
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandGlyph size={34} radius={9} />
          <h1 className="mt-3 text-page-title font-medium text-text-primary">
            Select an Organization
          </h1>
          <p className="mt-1 text-body text-text-secondary">
            You belong to multiple organizations. Choose one to enter.
          </p>
        </div>

        {/* Search (show when > 5 orgs) */}
        {orgs.length > 5 && (
          <Input
            type="text"
            placeholder="Search organizations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-6 max-w-none"
          />
        )}

        {error ? (
          <Banner variant="danger" className="mb-4">
            <OctagonXIcon />
            <BannerDescription>{error}</BannerDescription>
          </Banner>
        ) : null}

        {/* Org Cards */}
        <div className="flex flex-col gap-3">
          {filtered.map((org) => {
            const isSelecting = selecting === org.id
            return (
              <button
                key={org.id}
                onClick={() => handleSelect(org.id)}
                disabled={!!selecting}
                className="group flex w-full items-center gap-4 rounded-card border border-border-light bg-surface p-4 text-left shadow-card transition-colors duration-(--duration-fast) hover:border-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {/* Org icon */}
                <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary-subtle">
                  {org.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={org.logo_url} alt={org.name} className="size-8 rounded-xs object-contain" />
                  ) : (
                    <Building2Icon size={22} className="text-primary-text" />
                  )}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-text-primary">{org.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge variant={org.is_admin ? 'success' : 'neutral'}>
                      {org.is_admin ? 'Administrator' : 'Member'}
                    </Badge>
                    <span className="text-meta text-text-muted">
                      Since {formatDate(org.joined_at)}
                    </span>
                  </div>
                </div>

                {/* Arrow */}
                <div className="shrink-0 text-text-muted group-hover:text-primary-text">
                  {isSelecting ? null : <ArrowRightIcon size={20} />}
                </div>
              </button>
            )
          })}

          {filtered.length === 0 && (
            <div className="py-12 text-center text-body text-text-secondary">
              No organizations match your search.
            </div>
          )}
        </div>

        {/* Sign out link */}
        <div className="mt-8 text-center">
          <button
            onClick={logout}
            className="inline-flex items-center gap-1 text-body text-text-secondary hover:text-text-primary"
          >
            <LogOutIcon size={14} />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
