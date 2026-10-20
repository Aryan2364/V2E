'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { tasksApi } from '@/lib/api/tasks'
import type { EligibleAssigneesResponse } from '@/lib/types/tasks'

export type AssigneeSortMode = 'frequency' | 'workload' | 'name'

/**
 * The data and grouping behind the assignee pickers - one source for the
 * desktop dialog (AssigneeSelector) and the phone sheet. Fetches the eligible
 * assignees (the backend applies the visibility rules) when `open` turns true
 * and when the sort changes, re-fetches 300ms after the search text changes,
 * and groups the result by department with the current user and `hiddenIds`
 * left out (the current user is offered via the "Assign to me" shortcut).
 */
export function useEligibleAssignees({
  orgId,
  open,
  currentUserId,
  hiddenIds,
}: {
  orgId: string
  open: boolean
  currentUserId?: string
  hiddenIds?: string[]
}) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<AssigneeSortMode>('frequency')
  const [data, setData] = useState<EligibleAssigneesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchAssignees = useCallback(async (q: string, s: AssigneeSortMode) => {
    setLoading(true)
    setFailed(false)
    try {
      const result = await tasksApi.getEligibleAssignees(orgId, q || undefined, s)
      setData(result)
    } catch {
      setData({ departments: [], total: 0 })
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  // Fetch when opening, or when sort changes while open
  useEffect(() => {
    if (!open) return
    fetchAssignees(search, sort)
  }, [open, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search
  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchAssignees(search, sort)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  // Closing clears the search
  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  const departments = (data?.departments ?? [])
    .map((d) => ({ ...d, users: d.users.filter((u) => u.user_id !== currentUserId && !hiddenIds?.includes(u.user_id)) }))
    .filter((d) => d.users.length > 0)
  const visibleTotal = departments.reduce((n, d) => n + d.users.length, 0)

  return {
    search,
    setSearch,
    sort,
    setSort,
    data,
    loading,
    failed,
    departments,
    visibleTotal,
    reload: () => fetchAssignees(search, sort),
  }
}
