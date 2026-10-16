import React from 'react'

// Pass-through shell. The login page owns a full-bleed split-screen; the
// register and forgot-password pages center themselves.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-surface-sunken">{children}</div>
}
