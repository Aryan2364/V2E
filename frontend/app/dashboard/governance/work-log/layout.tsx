import React from 'react'

// Work log lives in the Governance menu. Each of its pages renders its own
// PageHeader with the shared WorkLogTabs, so the Governance sidebar stays
// persistent and this layout adds nothing around them.
export default function WorkLogLayout({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>
}
