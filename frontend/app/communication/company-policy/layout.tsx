// Communication's layout gives each page the bare content column beside its fixed
// sidebar (no padding). Company Policy pages expect the standard content padding,
// so it is applied once here rather than in every page.
export default function CompanyPolicyLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[calc(100vh-56px)] bg-[#F8FAFC] px-4 sm:px-6 lg:px-8 py-6 lg:py-8">{children}</div>
}
