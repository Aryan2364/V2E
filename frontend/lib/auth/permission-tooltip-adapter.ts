'use client'

/**
 * v2e kit-alignment P3, locked decision D1 ("presentation-only": no
 * permission-logic change). v2e's own permission system
 * (lib/auth/use-permissions.ts: usePermissions().can(featureKey, action),
 * loading, isAdmin, isSuperAdmin) is used at hundreds of call sites and is
 * NOT replaced or touched by this phase. The kit's
 * components/ui/permission-tooltip.tsx is decoupled from the kit's own
 * lib/permissions.ts on purpose: it only takes `allowed: boolean|undefined`
 * and `reason: string` as props, so it attaches to ANY permission source.
 *
 * This file is the thin adapter between the two: it reads v2e's
 * usePermissions() and returns the {allowed, reason} shape
 * PermissionTooltip needs, with v2e's `loading` flag mapped onto the kit's
 * `undefined` = "not known yet" convention (FRONTEND_RULES.md section 26.1).
 *
 * Usage at a call site:
 *
 *   const { allowed, reason } = useCanWithReason('tasks.delete', 'delete', 'delete tasks')
 *   <PermissionTooltip allowed={allowed} reason={reason}>
 *     <Button variant="danger" disabled={allowed !== true}>Delete task</Button>
 *   </PermissionTooltip>
 *
 * `label` is the section 26.2 wording ("Only people allowed to <label> can
 * do this."), written by the caller once per call site, the same way v2e
 * already writes its own copy — v2e has no generated permission-keys catalogue
 * (that machinery is the kit's own demo backend) so there is no reasonFor()
 * lookup table to generate from; this keeps the wording explicit instead.
 */
import { usePermissions, type UsePermissions } from './use-permissions'
import type { PermAction } from '@/lib/api/permissions'

export interface CanWithReason {
  /** true: allowed. false: not allowed, show the reason. undefined: not known yet. */
  allowed: boolean | undefined
  /** "Only people allowed to <label> can do this." */
  reason: string
}

/** Section 26.2's wording, built from a plain-English label. */
export function reasonFor(label: string): string {
  return `Only people allowed to ${label} can do this.`
}

/**
 * Wraps v2e's usePermissions().can(featureKey, action) as the
 * {allowed, reason} pair permission-tooltip.tsx (and anything else gating
 * on "may this person do this") needs. `loading` maps to `undefined`
 * (26.1): the control stays disabled with no reason until the answer has
 * actually landed, so nobody sees a wrong guess for a split second.
 */
export function useCanWithReason(featureKey: string, action: PermAction, label: string): CanWithReason {
  const { loading, can } = usePermissions()
  const allowed = loading ? undefined : can(featureKey, action)
  return { allowed, reason: reasonFor(label) }
}

/**
 * For shell/nav filtering (section 12.1: "an item the user cannot use is
 * not rendered"), where only the boolean matters and there is no tooltip
 * to word. Same loading -> undefined mapping; a nav item stays out of the
 * tree (not shown-then-hidden, section 26.1 rule 4) until an answer has
 * landed, by having its caller treat undefined the same as false for
 * visibility (never for enabling a control — that distinction is only
 * meaningful for permission-tooltip's disabled+reason case).
 */
export function useCanSee(featureKey: string, action: PermAction): boolean | undefined {
  const { loading, can }: UsePermissions = usePermissions()
  if (loading) return undefined
  return can(featureKey, action)
}
