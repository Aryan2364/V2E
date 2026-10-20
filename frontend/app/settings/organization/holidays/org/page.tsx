'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth/context'
import { holidaysApi } from '@/lib/api/holidays'
import type { OrgHoliday, OrgWorkingDays } from '@/lib/types/holidays'
import { Loader2, Upload, Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import WorkingWeekStrip from '@/components/holidays/WorkingWeekStrip'
import OrgHolidayList from '@/components/holidays/OrgHolidayList'
import OrgHolidayCalendar from '@/components/holidays/OrgHolidayCalendar'
import HolidayFormModal, { type HolidayFormData } from '@/components/holidays/HolidayFormModal'
import ImportHolidaysModal from '@/components/holidays/ImportHolidaysModal'
import HolidayDiscrepancyPanel from '@/components/holidays/HolidayDiscrepancyPanel'

export default function OrgCalendarPage() {
  const { user } = useAuth()
  const orgId = user?.organizationId ?? ''
  const isAdmin = !!user?.is_admin

  const [workingDays, setWorkingDays] = useState<OrgWorkingDays | null>(null)
  const [localDays, setLocalDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6])
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [holidays, setHolidays] = useState<OrgHoliday[]>([])
  const [loading, setLoading] = useState(true)
  const [showImport, setShowImport] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const [wd, hols] = await Promise.all([
        holidaysApi.getOrgWorkingDays(orgId),
        holidaysApi.listOrgHolidays(orgId, { year: selectedYear, status: 'active' }),
      ])
      setWorkingDays(wd)
      setLocalDays(wd.working_days)
      setHolidays(hols)
    } finally {
      setLoading(false)
    }
  }, [orgId, selectedYear])

  useEffect(() => { load() }, [load])

  async function saveWorkingDays(days: number[]) {
    const updated = await holidaysApi.updateOrgWorkingDays(orgId, days)
    setWorkingDays(updated)
    setLocalDays(updated.working_days)
  }

  async function addHoliday(data: HolidayFormData) {
    await holidaysApi.createOrgHoliday(orgId, {
      ...data,
      end_date: data.end_date || null,
      status: 'active',
      source: 'manual',
      description: data.description || null,
    })
    await load()
  }

  async function deleteHoliday(id: string) {
    await holidaysApi.deleteOrgHoliday(orgId, id)
    setHolidays((h) => h.filter((x) => x.id !== id))
  }

  async function updateHoliday(id: string, patch: Partial<OrgHoliday>) {
    await holidaysApi.updateOrgHoliday(orgId, id, patch)
    await load()
  }

  if (loading && !workingDays) {
    return <div className="flex items-center justify-center h-64"><Loader2 size={24} className="animate-spin text-text-muted" /></div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <h1 className="text-page-title font-medium text-text-primary">Org Calendar</h1>
        <p className="text-body text-text-secondary mt-1">Set your working days and holidays. They drive deadlines, leave, and reports.</p>
      </div>

      {/* Working days — slim, auto-saving strip */}
      <WorkingWeekStrip value={localDays} onSave={saveWorkingDays} disabled={!isAdmin} />

      {/* Holidays + calendar, side by side */}
      <div className="grid grid-cols-1 items-start gap-6 lg:min-h-[420px] lg:flex-1 lg:grid-cols-[minmax(0,1fr)_280px] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch">
        {/* Holidays list: the data area, so it takes the height left and scrolls itself */}
        <div className="bg-surface border border-border-light rounded-card p-4 shadow-card flex flex-col min-h-0">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4 shrink-0">
            <div className="flex items-center gap-3">
              <h2 className="text-section font-medium text-text-primary">Holidays</h2>
              {/* Year stepper — < 2026 > */}
              <div className="flex items-center gap-1 rounded-lg border border-border bg-surface">
                <button
                  type="button"
                  onClick={() => setSelectedYear((y) => y - 1)}
                  className="p-1.5 rounded-l-[7px] text-text-secondary hover:bg-surface-control transition-colors"
                  aria-label="Previous year"
                >
                  <ChevronLeft size={15} />
                </button>
                <span className="min-w-[44px] text-center text-body font-medium text-text-primary tabular-nums">{selectedYear}</span>
                <button
                  type="button"
                  onClick={() => setSelectedYear((y) => y + 1)}
                  className="p-1.5 rounded-r-[7px] text-text-secondary hover:bg-surface-control transition-colors"
                  aria-label="Next year"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>

            {isAdmin && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowImport(true)}
                  className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-body font-medium text-text-secondary hover:border-primary hover:text-primary-text transition-colors"
                >
                  <Upload size={14} />
                  Import CSV
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdd(true)}
                  className="flex items-center gap-1.5 h-9 px-4 rounded-lg text-body font-medium text-primary-foreground bg-primary hover:bg-primary-hover transition-colors"
                >
                  <Plus size={15} />
                  Add Holiday
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-16"><Loader2 size={18} className="animate-spin text-text-muted" /></div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <OrgHolidayList
                holidays={holidays}
                onDelete={deleteHoliday}
                onUpdate={updateHoliday}
                emptyText="No holidays for this year."
              />
            </div>
          )}
        </div>

        {/* Month calendar */}
        <OrgHolidayCalendar
          workingDays={localDays}
          holidays={holidays}
        />
      </div>

      {/* Department sync — who's removed org holidays, with re-enforce */}
      <HolidayDiscrepancyPanel orgId={orgId} isAdmin={isAdmin} />

      <HolidayFormModal
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
        onAdd={addHoliday}
      />

      {showImport && (
        <ImportHolidaysModal
          orgId={orgId}
          onClose={() => setShowImport(false)}
          onImported={() => { load() }}
        />
      )}
    </div>
  )
}
