'use client'

import * as React from 'react'
import { useLayout } from '@/lib/layout'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import Link from 'next/link'

/**
 * Adapted from the kit's components/shell/page-header.tsx (v2e
 * kit-alignment P3, task 4). Per locked decision D4, v2e's shell (top nav +
 * module sidebars) is kept as-is in this phase, not restructured into the
 * kit's AppShell, so the kit's phone branch of PageHeader — which draws the
 * screen's own app bar through useAppBarState/BelowAppBar/ProgressBar/
 * ShellLink (components/shell/app-bar.tsx, progress-bar.tsx) — is left out
 * here rather than half-wired against plumbing that does not exist yet.
 *
 * What IS ported, verbatim from the kit: the desktop/tablet branch
 * (FRONTEND_RULES.md sections 11.1 zone 1, 11.2 zones 1-2, 33.2) — title as
 * the page's one h1, an optional meta line, the one primary action to its
 * right, section tabs as the next sibling, and a breadcrumb built from
 * `trail`. `ShellLink` is replaced with a plain next/link `Link`, since
 * v2e has no page-loading-bar equivalent to suppress during a shell
 * navigation.
 *
 * On phone this currently renders the SAME desktop markup (no app bar, no
 * back arrow) rather than nothing, so a page that adopts PageHeader is at
 * least not left headerless on a phone that reaches it. Wiring the true
 * phone app bar here is follow-up work for whichever phase ports v2e's
 * phone shell pieces (components/phone/PhoneAppBar.tsx, lib/back.ts)
 * through this same component; see ADAPTERS.md.
 *
 * No existing page uses this yet (task 4: available, not migrated).
 */
type BreadcrumbTrailItem = { label: string; href: string }

type PageHeaderProps = {
  title: string
  /** The meta line under the title. Inline content: it sits in a <p>. */
  meta?: React.ReactNode
  /** The page's one primary action, right of the title. */
  actions?: React.ReactNode
  /** The page's section tabs (33), if it has them: a <SectionTabs>. */
  tabs?: React.ReactNode
} & (
  | { parent?: string; trail?: never }
  | { trail: BreadcrumbTrailItem[]; parent?: never }
)

function PageHeader({ title, meta, trail, actions, tabs }: PageHeaderProps) {
  // Phone wiring intentionally deferred (see file header); reserved for
  // the follow-up pass that ports v2e's phone app bar through this file.
  useLayout()

  const metaLine = meta != null ? <p className="mt-1 text-meta text-text-muted">{meta}</p> : null

  const header =
    actions == null ? (
      <div className="mb-6">
        <h1 className="text-page-title font-medium text-text-primary">{title}</h1>
        {metaLine}
      </div>
    ) : (
      <div className="mb-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="min-w-0 text-page-title font-medium text-text-primary">{title}</h1>
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        </div>
        {metaLine}
      </div>
    )

  const breadcrumb =
    trail !== undefined ? (
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          {trail.map((item) => (
            <React.Fragment key={item.href}>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href={item.href} />}>{item.label}</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
            </React.Fragment>
          ))}
          <BreadcrumbItem>
            <BreadcrumbPage>{title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    ) : null

  return (
    <>
      {breadcrumb}
      {header}
      {tabs}
    </>
  )
}

export { PageHeader, type BreadcrumbTrailItem }
