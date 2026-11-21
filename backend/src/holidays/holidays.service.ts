import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { HolidayOnTaskAction, HolidayEntityType, HolidayStatus, HolidayType, HolidayOptOutSource } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { ancestorChain, descendantIds, holidayReaches, orgHolidaySuppressed, type DeptNode } from './dept-tree.util'
import type { UpdateHolidayMasterDto } from './dto/update-holiday-master.dto'
import type { UpdateWorkingDaysDto } from './dto/update-working-days.dto'
import type { CreateOrgHolidayDto, UpdateOrgHolidayDto } from './dto/create-org-holiday.dto'
import type { CreateDepartmentHolidayDto, UpdateDepartmentHolidayDto } from './dto/create-department-holiday.dto'
import type { CreateIndividualHolidayDto, UpdateIndividualHolidayDto, CreateIndividualWorkingDaysDto, UpdateIndividualWorkingDaysDto } from './dto/create-individual-holiday.dto'

/** A resolved holiday plus where-it-came-from metadata for a calendar UI (dept or individual). */
export interface ResolvedDeptHoliday {
  id: string
  organization_id: string
  department_id: string
  name: string
  date: Date
  end_date: Date | null
  type: HolidayType
  is_recurring_yearly: boolean
  description: string | null
  status: HolidayStatus
  year: number
  created_at: Date
  updated_at: Date
  /**
   * Where this entry comes from relative to the viewing context:
   *   'own'        — created at this level (this department's, or the user's personal, holiday)
   *   'department' — inherited from an ancestor department's holiday
   *   'org'        — inherited from the organization-wide baseline
   */
  origin: 'own' | 'department' | 'org'
  /** True when this entry is inherited (origin 'department' or 'org'), i.e. a link not a copy. */
  inherited: boolean
  /** Origin department of an inherited dept holiday (the cascade source); null otherwise. */
  source_department_id: string | null
  source_department_name: string | null
  source_department_head_user_id: string | null
  source_department_head_name: string | null
  /** Human label for the source ("Organization" for org-origin); null for own holidays. */
  source_label: string | null
  /** For an own dept holiday: how many descendant departments it currently cascades to. */
  cascade_target_count: number
}

@Injectable()
export class HolidaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Defaults ────────────────────────────────────────────────────────────────

  async ensureDefaults(orgId: string) {
    const [master] = await Promise.all([
      this.prisma.holidayMaster.upsert({
        where: { organization_id: orgId },
        create: { organization_id: orgId },
        update: {},
      }),
      this.prisma.orgWorkingDays.upsert({
        where: { organization_id: orgId },
        // New orgs default to all 7 days working (no assumed weekend off).
        create: { organization_id: orgId, working_days: [0, 1, 2, 3, 4, 5, 6] },
        update: {},
      }),
    ])
    return master
  }

  // ─── Master config ────────────────────────────────────────────────────────────

  async getConfig(orgId: string) {
    return this.ensureDefaults(orgId)
  }

  async updateConfig(orgId: string, dto: UpdateHolidayMasterDto) {
    await this.ensureDefaults(orgId)
    const prev = await this.prisma.holidayMaster.findUnique({ where: { organization_id: orgId } })
    const updated = await this.prisma.holidayMaster.update({
      where: { organization_id: orgId },
      data: {
        ...(dto.country_code !== undefined && { country_code: dto.country_code }),
        ...(dto.holiday_on_task_action && { holiday_on_task_action: dto.holiday_on_task_action }),
        ...(dto.priority_level && { priority_level: dto.priority_level }),
        ...(dto.pending_review_deadline_days !== undefined && { pending_review_deadline_days: dto.pending_review_deadline_days }),
        ...(dto.auto_apply_if_not_reviewed !== undefined && { auto_apply_if_not_reviewed: dto.auto_apply_if_not_reviewed }),
      },
    })
    return updated
  }

  // ─── Working Day Calculation ──────────────────────────────────────────────────

  async isWorkingDay(date: Date, orgId: string, deptId?: string, userId?: string): Promise<boolean> {
    // Weekly schedule via the override chain (individual ⟶ dept ⟶ org default)…
    const workingDays = await this.effectiveWorkingDays(date, orgId, deptId, userId)
    if (!workingDays.includes(date.getDay())) return false
    // …then the unioned holiday set (org baseline + dept + individual, minus opt-outs).
    const holidays = await this.effectiveHolidays(orgId, deptId ?? null, userId ?? null, { activeOnly: true })
    return !this.matchesAnyHoliday(date, holidays)
  }

  /** Effective weekly working-day indices: individual override ?? dept override ?? org default. */
  private async effectiveWorkingDays(date: Date, orgId: string, deptId?: string, userId?: string): Promise<number[]> {
    if (userId) {
      // Most recently created individual schedule that covers this date.
      const schedule = await this.prisma.individualWorkingDays.findFirst({
        where: {
          organization_id: orgId,
          user_id: userId,
          effective_from: { lte: date },
          OR: [{ effective_to: null }, { effective_to: { gte: date } }],
        },
        orderBy: { created_at: 'desc' },
      })
      if (schedule) return schedule.working_days as number[]
    }
    if (deptId) {
      const wd = await this.prisma.departmentWorkingDays.findUnique({
        where: { organization_id_department_id: { organization_id: orgId, department_id: deptId } },
      })
      if (wd) return wd.working_days as number[]
    }
    const org = await this.prisma.orgWorkingDays.findUnique({ where: { organization_id: orgId } })
    // Default = ALL 7 days working. Many SMEs (esp. in India) run 7 days, so we
    // never assume a weekend off; an org marks days off explicitly if it wants.
    return (org?.working_days as number[]) ?? [0, 1, 2, 3, 4, 5, 6]
  }

  /**
   * The unioned effective holiday set for a context. Holidays are no longer resolved by
   * priority/override: an org holiday is a baseline that every department and individual
   * observes unless explicitly opted out, and each level adds its own on top:
   *   individual → org (minus dept & individual opt-outs) ∪ dept holidays (minus opt-outs) ∪ personal
   *   department → org (minus dept opt-outs) ∪ dept own/inherited (minus opt-outs)
   *   org-only   → all active org holidays
   * Feeds both the calendar UIs and the scheduling engine.
   */
  private async effectiveHolidays(
    orgId: string,
    deptId: string | null,
    userId: string | null,
    opts: { activeOnly?: boolean } = {},
  ): Promise<ResolvedDeptHoliday[]> {
    if (userId) return this.effectiveIndividualHolidays(orgId, userId, deptId, opts)
    if (deptId) return this.effectiveDeptHolidays(orgId, deptId, opts)
    return this.resolveOrgHolidaysForDept(orgId, null, opts)
  }

  /**
   * Whether `date` falls on a holiday — supporting both single-day holidays and
   * inclusive ranges (`end_date`). For recurring-yearly holidays only the month/day
   * matters, so a range is compared on month/day (handling a year-wrap span).
   */
  private dateMatchesHoliday(
    date: Date,
    h: { date: Date; end_date?: Date | null; is_recurring_yearly: boolean },
  ): boolean {
    const start = new Date(h.date)
    const end = h.end_date ? new Date(h.end_date) : start

    if (h.is_recurring_yearly) {
      const md = (d: Date) => (d.getMonth() + 1) * 100 + d.getDate()
      const s = md(start), e = md(end), x = md(date)
      return s <= e ? x >= s && x <= e : x >= s || x <= e
    }

    const dayMs = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const x = dayMs(date)
    return x >= dayMs(start) && x <= dayMs(end)
  }

  private matchesAnyHoliday(
    date: Date,
    holidays: { date: Date; end_date?: Date | null; is_recurring_yearly: boolean }[],
  ): boolean {
    return holidays.some((h) => this.dateMatchesHoliday(date, h))
  }

  // ─── Deadline Adjustment ──────────────────────────────────────────────────────

  async adjustDeadline(
    date: Date,
    orgId: string,
    deptId?: string,
    userId?: string,
    entityType?: HolidayEntityType,
    entityId?: string,
    entityTitle?: string,
    forTicket = false,
  ): Promise<Date | null> {
    const working = await this.isWorkingDay(date, orgId, deptId, userId)
    if (working) return date

    const master = await this.prisma.holidayMaster.findUnique({ where: { organization_id: orgId } })
    let action = master?.holiday_on_task_action ?? HolidayOnTaskAction.move_to_next_working_day

    // Tickets never skip — treat skip_create as move_to_next_working_day
    if (forTicket && action === HolidayOnTaskAction.skip_create) {
      action = HolidayOnTaskAction.move_to_next_working_day
    }

    const holidayName = await this.getHolidayNameForDate(date, orgId, deptId, userId)

    let adjusted: Date | null
    let auditAction: string

    switch (action) {
      case HolidayOnTaskAction.skip_create:
        adjusted = null
        auditAction = 'skipped'
        break
      case HolidayOnTaskAction.create_anyway:
        adjusted = date
        auditAction = 'created_anyway'
        break
      case HolidayOnTaskAction.move_to_prev_working_day:
        adjusted = await this.getPrevWorkingDay(date, orgId, deptId, userId)
        auditAction = 'moved_backward'
        break
      case HolidayOnTaskAction.move_to_next_working_day:
      default:
        adjusted = await this.getNextWorkingDay(date, orgId, deptId, userId)
        auditAction = 'moved_forward'
        break
    }

    // Holiday-driven deadline adjustments are recorded in the shared audit log
    // (resource "holiday", system actor) — there is no separate holiday audit
    // store. This mirrors the federation done by the audit backfill script.
    if (entityType && entityId && entityTitle) {
      await this.audit.record({
        orgId,
        actorType: 'system',
        action: auditAction,
        resource: 'holiday',
        entityId,
        entityType,
        entityLabel: entityTitle,
        changes: { date: { before: date, after: adjusted } },
        triggerSource: 'holiday_adjustment',
        triggerContext: { holiday_name: holidayName, holiday_date: date },
      })
    }

    return adjusted
  }

  private async getHolidayNameForDate(date: Date, orgId: string, deptId?: string, userId?: string): Promise<string> {
    // Name comes from the same unioned effective set used for scheduling.
    const holidays = await this.effectiveHolidays(orgId, deptId ?? null, userId ?? null, { activeOnly: true })
    const match = holidays.find((h) => this.dateMatchesHoliday(date, h))
    if (match) return match.name

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const workingDays = await this.effectiveWorkingDays(date, orgId, deptId, userId)
    if (!workingDays.includes(date.getDay())) return `${dayNames[date.getDay()]} (non-working day)`

    return 'Holiday'
  }

  async getNextWorkingDay(date: Date, orgId: string, deptId?: string, userId?: string): Promise<Date> {
    const d = new Date(date)
    for (let i = 0; i < 30; i++) {
      d.setDate(d.getDate() + 1)
      if (await this.isWorkingDay(d, orgId, deptId, userId)) return d
    }
    return d
  }

  async getPrevWorkingDay(date: Date, orgId: string, deptId?: string, userId?: string): Promise<Date> {
    const d = new Date(date)
    for (let i = 0; i < 30; i++) {
      d.setDate(d.getDate() - 1)
      if (await this.isWorkingDay(d, orgId, deptId, userId)) return d
    }
    return d
  }

  // ─── Range query ──────────────────────────────────────────────────────────────

  async getHolidaysInRange(orgId: string, from: Date, to: Date, deptId?: string, userId?: string) {
    const results: { date: string; name: string; level: string; type: string }[] = []
    const d = new Date(from)
    while (d <= to) {
      const isWorking = await this.isWorkingDay(d, orgId, deptId, userId)
      if (!isWorking) {
        const name = await this.getHolidayNameForDate(d, orgId, deptId, userId)
        results.push({
          date: d.toISOString().slice(0, 10),
          name,
          level: 'org',
          type: 'national',
        })
      }
      d.setDate(d.getDate() + 1)
    }
    return results
  }

  // ─── Date check utility ────────────────────────────────────────────────────────

  async checkDate(orgId: string, date: Date, deptId?: string, userId?: string) {
    await this.ensureDefaults(orgId)
    const isWorking = await this.isWorkingDay(date, orgId, deptId, userId)
    const master = await this.prisma.holidayMaster.findUnique({ where: { organization_id: orgId } })
    const action = master?.holiday_on_task_action ?? HolidayOnTaskAction.move_to_next_working_day

    let adjustedDate: string | null = null
    let reason = 'Working day'
    let actionStr = 'none'

    if (!isWorking) {
      const holidayName = await this.getHolidayNameForDate(date, orgId, deptId, userId)
      reason = holidayName
      switch (action) {
        case HolidayOnTaskAction.skip_create:
          adjustedDate = null
          actionStr = 'skip_create'
          break
        case HolidayOnTaskAction.create_anyway:
          adjustedDate = date.toISOString().slice(0, 10)
          actionStr = 'create_anyway'
          break
        case HolidayOnTaskAction.move_to_prev_working_day: {
          const prev = await this.getPrevWorkingDay(date, orgId, deptId, userId)
          adjustedDate = prev.toISOString().slice(0, 10)
          actionStr = 'move_to_prev_working_day'
          break
        }
        default: {
          const next = await this.getNextWorkingDay(date, orgId, deptId, userId)
          adjustedDate = next.toISOString().slice(0, 10)
          actionStr = 'move_to_next_working_day'
          break
        }
      }
    }

    return {
      is_working_day: isWorking,
      reason,
      adjusted_date: adjustedDate,
      action: actionStr,
    }
  }

  // ─── Bulk CSV import ─────────────────────────────────────────────────────────

  async bulkImportOrgHolidays(orgId: string, holidays: Array<{
    name: string
    date: string
    type?: string
    is_recurring_yearly?: boolean
    description?: string
  }>) {
    let imported = 0
    let skipped = 0
    for (const h of holidays) {
      const date = new Date(h.date)
      if (isNaN(date.getTime())) { skipped++; continue }
      const year = date.getFullYear()
      const existing = await this.prisma.orgHoliday.findFirst({
        where: { organization_id: orgId, date, name: h.name },
      })
      if (existing) { skipped++; continue }
      const type = (['national', 'company', 'regional'].includes(h.type ?? '') ? h.type : 'national') as HolidayType
      await this.prisma.orgHoliday.create({
        data: {
          organization_id: orgId,
          name: h.name,
          date,
          type,
          source: 'manual',
          status: HolidayStatus.active,
          year,
          is_recurring_yearly: h.is_recurring_yearly ?? false,
          description: h.description || null,
        },
      })
      imported++
    }
    return { imported, skipped }
  }

  // ─── Org working days & holidays ─────────────────────────────────────────────

  async getOrgWorkingDays(orgId: string) {
    await this.ensureDefaults(orgId)
    return this.prisma.orgWorkingDays.findUnique({ where: { organization_id: orgId } })
  }

  async updateOrgWorkingDays(orgId: string, dto: UpdateWorkingDaysDto) {
    await this.ensureDefaults(orgId)
    return this.prisma.orgWorkingDays.update({
      where: { organization_id: orgId },
      data: { working_days: dto.working_days as never },
    })
  }

  async listOrgHolidays(orgId: string, year?: number, type?: HolidayType, status?: HolidayStatus) {
    return this.prisma.orgHoliday.findMany({
      where: {
        organization_id: orgId,
        ...(year && { year }),
        ...(type && { type }),
        ...(status && { status }),
      },
      orderBy: { date: 'asc' },
    })
  }

  async createOrgHoliday(orgId: string, dto: CreateOrgHolidayDto) {
    const date = new Date(dto.date)
    // Only keep an end date when it's a genuine range (strictly after the start).
    const endDate = dto.end_date ? new Date(dto.end_date) : null
    const end = endDate && endDate.getTime() > date.getTime() ? endDate : null
    return this.prisma.orgHoliday.create({
      data: {
        organization_id: orgId,
        name: dto.name,
        date,
        end_date: end,
        type: dto.type,
        description: dto.description,
        is_recurring_yearly: dto.is_recurring_yearly ?? false,
        status: HolidayStatus.active,
        year: date.getFullYear(),
      },
    })
  }

  async updateOrgHoliday(orgId: string, id: string, dto: UpdateOrgHolidayDto) {
    await this.findOrgHolidayOrFail(orgId, id)
    const date = dto.date ? new Date(dto.date) : undefined
    const endDate = dto.end_date ? new Date(dto.end_date) : undefined
    return this.prisma.orgHoliday.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(date && { date, year: date.getFullYear() }),
        ...(dto.end_date !== undefined && { end_date: endDate ?? null }),
        ...(dto.type && { type: dto.type }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.is_recurring_yearly !== undefined && { is_recurring_yearly: dto.is_recurring_yearly }),
      },
    })
  }

  async deleteOrgHoliday(orgId: string, id: string) {
    await this.findOrgHolidayOrFail(orgId, id)
    // Dept opt-outs cascade via FK; individual opt-outs reference by id with no FK, so clean up.
    await this.prisma.individualHolidayOptOut.deleteMany({
      where: { organization_id: orgId, holiday_source: HolidayOptOutSource.org, holiday_id: id },
    })
    await this.prisma.orgHoliday.delete({ where: { id } })
    return { ok: true }
  }

  private async findOrgHolidayOrFail(orgId: string, id: string) {
    const h = await this.prisma.orgHoliday.findFirst({ where: { id, organization_id: orgId } })
    if (!h) throw new NotFoundException('Holiday not found')
    return h
  }

  // ─── Dept working days & holidays ────────────────────────────────────────────

  async getDeptWorkingDays(orgId: string, deptId: string) {
    return this.prisma.departmentWorkingDays.findUnique({
      where: { organization_id_department_id: { organization_id: orgId, department_id: deptId } },
    })
  }

  async upsertDeptWorkingDays(orgId: string, deptId: string, dto: UpdateWorkingDaysDto) {
    return this.prisma.departmentWorkingDays.upsert({
      where: { organization_id_department_id: { organization_id: orgId, department_id: deptId } },
      create: { organization_id: orgId, department_id: deptId, working_days: dto.working_days as never },
      update: { working_days: dto.working_days as never },
    })
  }

  async deleteDeptWorkingDays(orgId: string, deptId: string) {
    const existing = await this.prisma.departmentWorkingDays.findUnique({
      where: { organization_id_department_id: { organization_id: orgId, department_id: deptId } },
    })
    if (!existing) return { ok: true }
    await this.prisma.departmentWorkingDays.delete({
      where: { organization_id_department_id: { organization_id: orgId, department_id: deptId } },
    })
    return { ok: true }
  }

  /** Org departments as the lightweight tree shape used for cascade resolution. */
  private async getDeptNodes(orgId: string): Promise<DeptNode[]> {
    const rows = await this.prisma.department.findMany({
      where: { organization_id: orgId },
      select: { id: true, parent_department_id: true },
    })
    return rows.map((r) => ({ id: r.id, parent_department_id: r.parent_department_id }))
  }

  /**
   * The effective holidays for a department: its own holidays plus any inherited
   * from ancestor departments (by link, not copy), minus locally opted-out ones.
   *
   * An ancestor holiday H reaches this department only if the department is in
   * H's target set (the checked cascade list). It is then dropped if an opt-out
   * sits anywhere on the path from H's origin down to this department — that is
   * what makes opt-out flow DOWN only and never affect siblings or the parent.
   *
   * This single resolver feeds both the calendar UI and the scheduling engine.
   */
  private async resolveDeptHolidays(
    orgId: string,
    deptId: string,
    opts: { activeOnly?: boolean } = {},
  ): Promise<ResolvedDeptHoliday[]> {
    const statusFilter = opts.activeOnly ? { status: HolidayStatus.active } : {}

    const [deptRows, ownRows] = await Promise.all([
      this.prisma.department.findMany({
        where: { organization_id: orgId },
        select: {
          id: true,
          name: true,
          parent_department_id: true,
          head_user_id: true,
          head_user: { select: { id: true, name: true } },
        },
      }),
      this.prisma.departmentHoliday.findMany({
        where: { organization_id: orgId, department_id: deptId, ...statusFilter },
        include: { _count: { select: { targets: true } } },
      }),
    ])

    const nodes: DeptNode[] = deptRows.map((d) => ({ id: d.id, parent_department_id: d.parent_department_id }))
    const deptById = new Map(deptRows.map((d) => [d.id, d]))
    const chain = ancestorChain(nodes, deptId) // root → … → self
    const originIds = chain.slice(0, -1) // every ancestor, any depth

    const out: ResolvedDeptHoliday[] = ownRows.map((h) => ({
      ...h,
      origin: 'own' as const,
      inherited: false,
      source_department_id: null,
      source_department_name: null,
      source_department_head_user_id: null,
      source_department_head_name: null,
      source_label: null,
      cascade_target_count: h._count.targets,
    }))

    if (originIds.length) {
      const candidates = await this.prisma.departmentHoliday.findMany({
        where: { organization_id: orgId, department_id: { in: originIds }, ...statusFilter },
        include: { targets: true, opt_outs: true },
      })

      for (const h of candidates) {
        // Reaches this department only if it is a target and no opt-out sits on
        // the path from origin down to here (down-only detach). See holidayReaches.
        const reaches = holidayReaches(chain, deptId, {
          originId: h.department_id,
          targetIds: h.targets.map((t) => t.department_id),
          optOutIds: h.opt_outs.map((o) => o.department_id),
        })
        if (!reaches) continue

        const src = deptById.get(h.department_id)
        out.push({
          id: h.id,
          organization_id: h.organization_id,
          department_id: h.department_id,
          name: h.name,
          date: h.date,
          end_date: h.end_date,
          type: h.type,
          is_recurring_yearly: h.is_recurring_yearly,
          description: h.description,
          status: h.status,
          year: h.year,
          created_at: h.created_at,
          updated_at: h.updated_at,
          origin: 'department' as const,
          inherited: true,
          source_department_id: h.department_id,
          source_department_name: src?.name ?? null,
          source_department_head_user_id: src?.head_user_id ?? null,
          source_department_head_name: src?.head_user?.name ?? null,
          source_label: src?.name ?? null,
          cascade_target_count: 0,
        })
      }
    }

    out.sort((a, b) => a.date.getTime() - b.date.getTime())
    return out
  }

  /**
   * Active (or all) ORG holidays as the baseline for a department, dropping those the
   * department has opted out of. With `deptId` null this is simply every org holiday
   * (the org-only context). Org holidays are surfaced as inherited entries with
   * `origin:'org'` and source label "Organization".
   */
  private async resolveOrgHolidaysForDept(
    orgId: string,
    deptId: string | null,
    opts: { activeOnly?: boolean } = {},
  ): Promise<ResolvedDeptHoliday[]> {
    const statusFilter = opts.activeOnly ? { status: HolidayStatus.active } : {}
    const orgHolidays = await this.prisma.orgHoliday.findMany({
      where: { organization_id: orgId, ...statusFilter },
      orderBy: { date: 'asc' },
    })

    const suppressed = new Set<string>()
    if (deptId) {
      const chain = ancestorChain(await this.getDeptNodes(orgId), deptId)
      const optOuts = await this.prisma.orgHolidayOptOut.findMany({
        where: { organization_id: orgId, department_id: { in: chain } },
      })
      const byHoliday = new Map<string, { departmentId: string; appliesToSubtree: boolean }[]>()
      for (const o of optOuts) {
        const arr = byHoliday.get(o.org_holiday_id) ?? []
        arr.push({ departmentId: o.department_id, appliesToSubtree: o.applies_to_subtree })
        byHoliday.set(o.org_holiday_id, arr)
      }
      for (const h of orgHolidays) {
        const anchors = byHoliday.get(h.id)
        if (anchors && orgHolidaySuppressed(chain, deptId, anchors)) suppressed.add(h.id)
      }
    }

    return orgHolidays
      .filter((h) => !suppressed.has(h.id))
      .map((h) => ({
        id: h.id,
        organization_id: h.organization_id,
        department_id: '',
        name: h.name,
        date: h.date,
        end_date: h.end_date,
        type: h.type,
        is_recurring_yearly: h.is_recurring_yearly,
        description: h.description,
        status: h.status,
        year: h.year,
        created_at: h.created_at,
        updated_at: h.updated_at,
        origin: 'org' as const,
        inherited: true,
        source_department_id: null,
        source_department_name: null,
        source_department_head_user_id: null,
        source_department_head_name: null,
        source_label: 'Organization',
        cascade_target_count: 0,
      }))
  }

  /** A department's full effective set: org baseline (minus dept opt-outs) ∪ its own/inherited dept holidays. */
  private async effectiveDeptHolidays(
    orgId: string,
    deptId: string,
    opts: { activeOnly?: boolean } = {},
  ): Promise<ResolvedDeptHoliday[]> {
    const [org, dept] = await Promise.all([
      this.resolveOrgHolidaysForDept(orgId, deptId, opts),
      this.resolveDeptHolidays(orgId, deptId, opts),
    ])
    return [...org, ...dept].sort((a, b) => a.date.getTime() - b.date.getTime())
  }

  /**
   * An individual's full effective set: the department's effective set (or the org baseline
   * if they belong to no department), minus the user's personal opt-outs, plus their own
   * personal holidays. An inherited entry is matched to an opt-out by (source, holiday id),
   * where source is 'org' for org-origin entries and 'department' for everything else.
   */
  private async effectiveIndividualHolidays(
    orgId: string,
    userId: string,
    deptId: string | null,
    opts: { activeOnly?: boolean } = {},
  ): Promise<ResolvedDeptHoliday[]> {
    const base = deptId
      ? await this.effectiveDeptHolidays(orgId, deptId, opts)
      : await this.resolveOrgHolidaysForDept(orgId, null, opts)

    // From the employee's vantage point everything from the department layer is inherited —
    // including the department's OWN holidays (origin 'own' in the dept context). Re-tag so
    // they render as inherited (not personal) and carry the department's name as the source.
    const dept = deptId
      ? await this.prisma.department.findUnique({ where: { id: deptId }, select: { name: true } })
      : null
    const optOuts = await this.prisma.individualHolidayOptOut.findMany({
      where: { organization_id: orgId, user_id: userId },
    })
    const suppressed = new Set(optOuts.map((o) => `${o.holiday_source}:${o.holiday_id}`))
    const inherited = base
      .filter((h) => !suppressed.has(`${h.origin === 'org' ? 'org' : 'department'}:${h.id}`))
      .map((h) =>
        h.origin === 'org'
          ? h
          : {
              ...h,
              origin: 'department' as const,
              inherited: true,
              source_label: h.source_label ?? h.source_department_name ?? dept?.name ?? 'Department',
            },
      )

    const ownRows = await this.prisma.individualHoliday.findMany({
      where: { organization_id: orgId, user_id: userId },
    })
    const own: ResolvedDeptHoliday[] = ownRows.map((h) => ({
      id: h.id,
      organization_id: h.organization_id,
      department_id: '',
      name: h.name,
      date: h.date,
      end_date: null,
      type: h.type,
      is_recurring_yearly: h.is_recurring_yearly,
      description: h.description,
      status: HolidayStatus.active,
      year: h.year,
      created_at: h.created_at,
      updated_at: h.updated_at,
      origin: 'own' as const,
      inherited: false,
      source_department_id: null,
      source_department_name: null,
      source_department_head_user_id: null,
      source_department_head_name: null,
      source_label: null,
      cascade_target_count: 0,
    }))

    return [...inherited, ...own].sort((a, b) => a.date.getTime() - b.date.getTime())
  }

  /** Keep only ids that are genuine descendants of the origin department. */
  private async validTargetIds(orgId: string, originDeptId: string, ids?: string[]): Promise<string[]> {
    if (!ids?.length) return []
    const descendants = descendantIds(await this.getDeptNodes(orgId), originDeptId)
    return Array.from(new Set(ids.filter((id) => descendants.has(id))))
  }

  async listDeptHolidays(orgId: string, deptId: string, year?: number) {
    // Effective set = org baseline (minus this dept's opt-outs) ∪ own/inherited dept holidays.
    const resolved = await this.effectiveDeptHolidays(orgId, deptId)
    // Match by exact year, but always surface recurring-yearly holidays.
    return year ? resolved.filter((h) => h.year === year || h.is_recurring_yearly) : resolved
  }

  async createDeptHoliday(orgId: string, deptId: string, dto: CreateDepartmentHolidayDto) {
    const date = new Date(dto.date)
    const endDate = dto.end_date ? new Date(dto.end_date) : null
    const end = endDate && endDate.getTime() > date.getTime() ? endDate : null
    const holiday = await this.prisma.departmentHoliday.create({
      data: {
        organization_id: orgId,
        department_id: deptId,
        name: dto.name,
        date,
        end_date: end,
        type: dto.type,
        description: dto.description,
        is_recurring_yearly: dto.is_recurring_yearly ?? false,
        status: HolidayStatus.active,
        year: date.getFullYear(),
      },
    })

    const targets = await this.validTargetIds(orgId, deptId, dto.target_department_ids)
    if (targets.length) {
      await this.prisma.departmentHolidayTarget.createMany({
        data: targets.map((department_id) => ({ organization_id: orgId, holiday_id: holiday.id, department_id })),
        skipDuplicates: true,
      })
    }
    return holiday
  }

  async updateDeptHoliday(orgId: string, deptId: string, id: string, dto: UpdateDepartmentHolidayDto) {
    const existing = await this.prisma.departmentHoliday.findFirst({ where: { id, organization_id: orgId, department_id: deptId } })
    if (!existing) throw new NotFoundException('Department holiday not found')
    const date = dto.date ? new Date(dto.date) : undefined
    const endDate = dto.end_date ? new Date(dto.end_date) : undefined
    const updated = await this.prisma.departmentHoliday.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(date && { date, year: date.getFullYear() }),
        ...(dto.end_date !== undefined && { end_date: endDate ?? null }),
        ...(dto.type && { type: dto.type }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.is_recurring_yearly !== undefined && { is_recurring_yearly: dto.is_recurring_yearly }),
      },
    })

    // Replace the cascade reach wholesale when the caller sends a target list.
    if (dto.target_department_ids !== undefined) {
      const targets = await this.validTargetIds(orgId, deptId, dto.target_department_ids)
      await this.prisma.departmentHolidayTarget.deleteMany({ where: { holiday_id: id } })
      if (targets.length) {
        await this.prisma.departmentHolidayTarget.createMany({
          data: targets.map((department_id) => ({ organization_id: orgId, holiday_id: id, department_id })),
          skipDuplicates: true,
        })
      }
    }
    return updated
  }

  async deleteDeptHoliday(orgId: string, deptId: string, id: string) {
    const existing = await this.prisma.departmentHoliday.findFirst({ where: { id, organization_id: orgId, department_id: deptId } })
    if (!existing) throw new NotFoundException('Department holiday not found')
    // Targets + dept opt-outs cascade via FK; individual opt-outs reference by id with no FK.
    await this.prisma.individualHolidayOptOut.deleteMany({
      where: { organization_id: orgId, holiday_source: HolidayOptOutSource.department, holiday_id: id },
    })
    await this.prisma.departmentHoliday.delete({ where: { id } })
    return { ok: true }
  }

  // ─── Cascade opt-out (local detach of an inherited holiday) ───────────────────

  /**
   * Opt a department out of an inherited holiday. The detach applies to this
   * department and its descendants only — parent and siblings keep the holiday.
   * The SOURCE department's head (the cascade origin) is notified, and the
   * action is written to the shared audit log.
   */
  async optOutDeptHoliday(orgId: string, deptId: string, holidayId: string, actorId: string) {
    const holiday = await this.prisma.departmentHoliday.findFirst({ where: { id: holidayId, organization_id: orgId } })
    if (!holiday) throw new NotFoundException('Department holiday not found')
    if (holiday.department_id === deptId) {
      throw new BadRequestException('Cannot opt out of a holiday this department owns — delete it instead.')
    }
    const target = await this.prisma.departmentHolidayTarget.findUnique({
      where: { holiday_id_department_id: { holiday_id: holidayId, department_id: deptId } },
    })
    if (!target) throw new BadRequestException('This holiday is not inherited by this department.')

    await this.prisma.departmentHolidayOptOut.upsert({
      where: { holiday_id_department_id: { holiday_id: holidayId, department_id: deptId } },
      create: { organization_id: orgId, holiday_id: holidayId, department_id: deptId, opted_out_by_user_id: actorId },
      update: {},
    })

    const [optingDept, sourceDept] = await Promise.all([
      this.prisma.department.findUnique({ where: { id: deptId }, select: { name: true } }),
      this.prisma.department.findUnique({
        where: { id: holiday.department_id },
        select: { name: true, head_user_id: true },
      }),
    ])
    const optingName = optingDept?.name ?? 'A department'
    const sourceName = sourceDept?.name ?? 'the source department'

    await this.audit.record({
      orgId,
      actorId,
      action: 'update',
      resource: 'department_holiday',
      entityId: holidayId,
      entityLabel: holiday.name,
      changes: { opted_out_by_department: { before: null, after: `${optingName} (${deptId})` } },
    })

    // Notify the SOURCE department's head — it's their holiday being declined.
    if (sourceDept?.head_user_id && sourceDept.head_user_id !== actorId) {
      await this.notifications.emit({
        orgId,
        module: 'system',
        event_type: 'holiday_opted_out',
        recipients: [sourceDept.head_user_id],
        title: 'Department opted out of a holiday',
        body: `${optingName} opted out of "${holiday.name}" (cascaded from ${sourceName}). It still applies to ${sourceName} and all other departments.`,
        link: '/settings/organization/holidays/departments',
        entity: { type: 'department_holiday', id: holidayId },
      })
    }

    return { ok: true }
  }

  /** Reverse a local opt-out (re-attach the inherited holiday for this department). */
  async undoOptOutDeptHoliday(orgId: string, deptId: string, holidayId: string, actorId: string) {
    const holiday = await this.prisma.departmentHoliday.findFirst({ where: { id: holidayId, organization_id: orgId } })
    if (!holiday) throw new NotFoundException('Department holiday not found')

    const removed = await this.prisma.departmentHolidayOptOut.deleteMany({
      where: { holiday_id: holidayId, department_id: deptId },
    })
    if (removed.count > 0) {
      const optingDept = await this.prisma.department.findUnique({ where: { id: deptId }, select: { name: true } })
      await this.audit.record({
        orgId,
        actorId,
        action: 'update',
        resource: 'department_holiday',
        entityId: holidayId,
        entityLabel: holiday.name,
        changes: { opted_out_by_department: { before: `${optingDept?.name ?? deptId} (${deptId})`, after: null } },
      })
    }
    return { ok: true }
  }

  // ─── Org-holiday opt-out (a department removes an org-wide holiday) ────────────

  /**
   * Remove (opt out of) one or more ORG holidays for a department. `appliesToSubtree`
   * captures the remover's choice: false suppresses only this department, true cascades
   * to every descendant (and a descendant cannot re-add it — the parent's call is
   * authoritative). Reversible suppression records; surfaced in the org discrepancy panel
   * and the shared audit log.
   */
  async optOutOrgHolidaysForDept(
    orgId: string,
    deptId: string,
    orgHolidayIds: string[],
    appliesToSubtree: boolean,
    actorId: string,
  ) {
    const dept = await this.prisma.department.findFirst({
      where: { id: deptId, organization_id: orgId },
      select: { name: true },
    })
    if (!dept) throw new NotFoundException('Department not found')
    const holidays = await this.prisma.orgHoliday.findMany({
      where: { id: { in: orgHolidayIds }, organization_id: orgId },
    })
    if (!holidays.length) throw new BadRequestException('No matching org holidays to remove.')

    for (const h of holidays) {
      await this.prisma.orgHolidayOptOut.upsert({
        where: { org_holiday_id_department_id: { org_holiday_id: h.id, department_id: deptId } },
        create: {
          organization_id: orgId,
          org_holiday_id: h.id,
          department_id: deptId,
          applies_to_subtree: appliesToSubtree,
          opted_out_by_user_id: actorId,
        },
        update: { applies_to_subtree: appliesToSubtree, opted_out_by_user_id: actorId },
      })
      await this.audit.record({
        orgId,
        actorId,
        action: 'update',
        resource: 'org_holiday',
        entityId: h.id,
        entityLabel: h.name,
        changes: {
          removed_by_department: {
            before: null,
            after: `${dept.name} (${deptId})${appliesToSubtree ? ' + sub-departments' : ''}`,
          },
        },
      })
    }
    return { ok: true }
  }

  /** Reverse a department's org-holiday removal (re-enforce the org baseline for it). */
  async undoOptOutOrgHolidaysForDept(orgId: string, deptId: string, orgHolidayIds: string[], actorId: string) {
    const holidays = await this.prisma.orgHoliday.findMany({
      where: { id: { in: orgHolidayIds }, organization_id: orgId },
    })
    const removed = await this.prisma.orgHolidayOptOut.deleteMany({
      where: { organization_id: orgId, department_id: deptId, org_holiday_id: { in: orgHolidayIds } },
    })
    if (removed.count > 0) {
      const dept = await this.prisma.department.findUnique({ where: { id: deptId }, select: { name: true } })
      for (const h of holidays) {
        await this.audit.record({
          orgId,
          actorId,
          action: 'update',
          resource: 'org_holiday',
          entityId: h.id,
          entityLabel: h.name,
          changes: { removed_by_department: { before: `${dept?.name ?? deptId} (${deptId})`, after: null } },
        })
      }
    }
    return { ok: true }
  }

  /**
   * Per-department report of org holidays that have been removed (out of sync with the org
   * calendar). Powers the org-page discrepancy panel and the "re-enforce" affordance.
   */
  async getOrgHolidayDiscrepancies(orgId: string) {
    const optOuts = await this.prisma.orgHolidayOptOut.findMany({
      where: { organization_id: orgId },
      include: { holiday: { select: { id: true, name: true, date: true, type: true } } },
      orderBy: { created_at: 'desc' },
    })
    if (!optOuts.length) return []

    const deptIds = [...new Set(optOuts.map((o) => o.department_id))]
    const userIds = [...new Set(optOuts.map((o) => o.opted_out_by_user_id))]
    const [depts, users] = await Promise.all([
      this.prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    ])
    const deptName = new Map(depts.map((d) => [d.id, d.name]))
    const userName = new Map(users.map((u) => [u.id, u.name]))

    const byDept = new Map<
      string,
      { department_id: string; department_name: string; removed: unknown[] }
    >()
    for (const o of optOuts) {
      const entry =
        byDept.get(o.department_id) ??
        { department_id: o.department_id, department_name: deptName.get(o.department_id) ?? 'Unknown department', removed: [] }
      entry.removed.push({
        org_holiday_id: o.org_holiday_id,
        name: o.holiday?.name ?? '',
        date: o.holiday?.date ?? null,
        type: o.holiday?.type ?? null,
        applies_to_subtree: o.applies_to_subtree,
        opted_out_by_user_id: o.opted_out_by_user_id,
        opted_out_by_name: userName.get(o.opted_out_by_user_id) ?? null,
        created_at: o.created_at,
      })
      byDept.set(o.department_id, entry)
    }
    return Array.from(byDept.values()).sort((a, b) => a.department_name.localeCompare(b.department_name))
  }

  // ─── Individual holiday opt-out (an employee removes an inherited holiday) ─────

  /**
   * Remove (opt out of) one or more inherited holidays for a single employee. Each item
   * names the source ('org' or 'department') and the underlying holiday id. The employee's
   * own personal holidays are deleted via `deleteUserHoliday`, not opted out. Reversible.
   */
  async optOutHolidaysForUser(
    orgId: string,
    userId: string,
    items: { holiday_source: HolidayOptOutSource; holiday_id: string }[],
    actorId: string,
  ) {
    if (!items.length) throw new BadRequestException('No holidays to remove.')
    for (const it of items) {
      await this.prisma.individualHolidayOptOut.upsert({
        where: {
          user_id_holiday_source_holiday_id: {
            user_id: userId,
            holiday_source: it.holiday_source,
            holiday_id: it.holiday_id,
          },
        },
        create: {
          organization_id: orgId,
          user_id: userId,
          holiday_source: it.holiday_source,
          holiday_id: it.holiday_id,
          opted_out_by_user_id: actorId,
        },
        update: {},
      })
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
    await this.audit.record({
      orgId,
      actorId,
      action: 'update',
      resource: 'individual_holiday',
      entityId: userId,
      entityType: 'user',
      entityLabel: user?.name ?? userId,
      changes: { removed_holidays: { before: null, after: items.length } },
    })
    return { ok: true }
  }

  /** Reverse one or more of an employee's holiday removals (re-attach the inherited holidays). */
  async undoOptOutHolidaysForUser(
    orgId: string,
    userId: string,
    items: { holiday_source: HolidayOptOutSource; holiday_id: string }[],
    actorId: string,
  ) {
    if (!items.length) return { ok: true }
    const removed = await this.prisma.individualHolidayOptOut.deleteMany({
      where: {
        organization_id: orgId,
        user_id: userId,
        OR: items.map((it) => ({ holiday_source: it.holiday_source, holiday_id: it.holiday_id })),
      },
    })
    if (removed.count > 0) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
      await this.audit.record({
        orgId,
        actorId,
        action: 'update',
        resource: 'individual_holiday',
        entityId: userId,
        entityType: 'user',
        entityLabel: user?.name ?? userId,
        changes: { restored_holidays: { before: null, after: removed.count } },
      })
    }
    return { ok: true }
  }

  // ─── Individual working days & holidays ──────────────────────────────────────

  async listUserWorkingDays(orgId: string, userId: string) {
    return this.prisma.individualWorkingDays.findMany({
      where: { organization_id: orgId, user_id: userId },
      orderBy: { effective_from: 'desc' },
    })
  }

  async createUserWorkingDays(orgId: string, userId: string, dto: CreateIndividualWorkingDaysDto) {
    return this.prisma.individualWorkingDays.create({
      data: {
        organization_id: orgId,
        user_id: userId,
        working_days: dto.working_days as never,
        effective_from: new Date(dto.effective_from),
        effective_to: dto.effective_to ? new Date(dto.effective_to) : null,
      },
    })
  }

  async updateUserWorkingDays(orgId: string, userId: string, id: string, dto: UpdateIndividualWorkingDaysDto) {
    const existing = await this.prisma.individualWorkingDays.findFirst({ where: { id, organization_id: orgId, user_id: userId } })
    if (!existing) throw new NotFoundException('Working days schedule not found')
    return this.prisma.individualWorkingDays.update({
      where: { id },
      data: {
        ...(dto.working_days && { working_days: dto.working_days as never }),
        ...(dto.effective_from && { effective_from: new Date(dto.effective_from) }),
        ...(dto.effective_to !== undefined && { effective_to: dto.effective_to ? new Date(dto.effective_to) : null }),
      },
    })
  }

  async deleteUserWorkingDays(orgId: string, userId: string, id: string) {
    const existing = await this.prisma.individualWorkingDays.findFirst({ where: { id, organization_id: orgId, user_id: userId } })
    if (!existing) throw new NotFoundException('Working days schedule not found')
    await this.prisma.individualWorkingDays.delete({ where: { id } })
    return { ok: true }
  }

  async listUserHolidays(orgId: string, userId: string, year?: number) {
    // Effective set = the user's department's effective set (org baseline + dept, minus
    // dept opt-outs) minus the user's personal opt-outs, plus their personal holidays.
    const profile = await this.prisma.employeeProfile.findFirst({
      where: { organization_id: orgId, user_id: userId },
      select: { department_id: true },
    })
    const resolved = await this.effectiveIndividualHolidays(orgId, userId, profile?.department_id ?? null)
    return year ? resolved.filter((h) => h.year === year || h.is_recurring_yearly) : resolved
  }

  async createUserHoliday(orgId: string, userId: string, dto: CreateIndividualHolidayDto) {
    const date = new Date(dto.date)
    return this.prisma.individualHoliday.create({
      data: {
        organization_id: orgId,
        user_id: userId,
        name: dto.name,
        date,
        type: dto.type,
        description: dto.description,
        is_recurring_yearly: dto.is_recurring_yearly ?? false,
        year: date.getFullYear(),
      },
    })
  }

  async updateUserHoliday(orgId: string, userId: string, id: string, dto: UpdateIndividualHolidayDto) {
    const existing = await this.prisma.individualHoliday.findFirst({ where: { id, organization_id: orgId, user_id: userId } })
    if (!existing) throw new NotFoundException('Individual holiday not found')
    const date = dto.date ? new Date(dto.date) : undefined
    return this.prisma.individualHoliday.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(date && { date, year: date.getFullYear() }),
        ...(dto.type && { type: dto.type }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.is_recurring_yearly !== undefined && { is_recurring_yearly: dto.is_recurring_yearly }),
      },
    })
  }

  async deleteUserHoliday(orgId: string, userId: string, id: string) {
    const existing = await this.prisma.individualHoliday.findFirst({ where: { id, organization_id: orgId, user_id: userId } })
    if (!existing) throw new NotFoundException('Individual holiday not found')
    await this.prisma.individualHoliday.delete({ where: { id } })
    return { ok: true }
  }

}
