'use client'

/**
 * Full-screen boot splash. Shown while the app restores/refreshes the session on
 * a cold load, so a logged-in user sees a branded loading screen instead of a
 * flash of blank page or the login form before their dashboard resolves.
 */
export default function BootSplash() {
  return (
    <div className="fixed inset-0 z-9999 flex flex-col items-center justify-center bg-[#F8FAFC]">
      <div className="flex flex-col items-center">
        <span className="text-[34px] font-bold tracking-tight text-[#0F172A]">V2E</span>
        <p className="mt-1 text-sm text-[#475569]">The operating system for your organisation</p>

        {/* Indeterminate loading bar */}
        <div className="relative mt-7 h-[4px] w-[200px] overflow-hidden rounded-full bg-[#E2E8F0]">
          <span className="boot-bar" />
        </div>
      </div>
    </div>
  )
}
