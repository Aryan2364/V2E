import React from 'react'

/**
 * V2E logo mark — "Vision to Execution".
 *
 * A vision node (the dot motif already used across the app) with an ascending
 * arrow rising out of it: vision → execution / results. Reusable so the plain
 * "V2E" text in the sidebar, top nav and boot splash can adopt it later.
 */

type Tone = 'dark' | 'light'

const SIZES = {
  sm: { tile: 28, radius: 8, word: 'text-[18px]' },
  md: { tile: 34, radius: 9, word: 'text-[22px]' },
  lg: { tile: 44, radius: 12, word: 'text-[26px]' },
} as const

export function BrandGlyph({
  size = 34,
  radius = 9,
  tone = 'light',
  className = '',
}: {
  size?: number
  radius?: number
  tone?: Tone
  className?: string
}) {
  // Unique gradient id per render tone so multiple marks on a page don't collide.
  const gid = `v2e-mark-${tone}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="V2E"
      className={className}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--primary-text)" />
          <stop offset="1" stopColor="var(--primary-text)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx={radius} fill={`url(#${gid})`} />
      {/* vision node */}
      <circle cx="9" cy="22" r="2.4" fill="var(--surface)" />
      {/* journey to execution */}
      <path
        d="M10.5 20.5 L21 9.5"
        stroke="var(--border-light)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* execution arrowhead */}
      <path
        d="M15 9.5 L21.5 9.5 L21.5 16"
        stroke="var(--border-light)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function BrandMark({
  size = 'md',
  tone = 'light',
  showWordmark = true,
  className = '',
}: {
  size?: keyof typeof SIZES
  tone?: Tone
  showWordmark?: boolean
  className?: string
}) {
  const s = SIZES[size]
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <BrandGlyph size={s.tile} radius={s.radius} tone={tone} />
      {showWordmark && (
        <span
          className={`font-bold tracking-tight select-none ${s.word} ${
            tone === 'dark' ? 'text-white' : 'text-text-primary'
          }`}
        >
          V2E
        </span>
      )}
    </span>
  )
}
