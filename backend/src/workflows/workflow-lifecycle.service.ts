import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ClockService } from '../clock/clock.service'
import { MSG_CHANGE_CREATOR, MSG_NOT_FOUND } from './workflow-template.types'
import { Principal } from '../access-rights/permissions.service'
import { PrismaService } from '../prisma/prisma.service'
import { WorkflowAccessService } from './workflow-access.service'
import { WorkflowTemplateViewService } from './workflow-template-view.service'
import { assertActiveOrgMembers } from '../common/org-members'
import { isAdminPrincipal } from './workflow-access'
import { markSchedulesFiredUpTo } from './workflow-definition.validation'

/** Template lifecycle (pause / resume / archive / restore) and changing a workflow's creator. */
@Injectable()
export class WorkflowLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly access: WorkflowAccessService,
    private readonly templateView: WorkflowTemplateViewService,
  ) {}

  /** Pause a Live workflow: no new runs, schedules skip. Running runs carry on. */
  async pauseTemplate(orgId: string, templateId: string, p: Principal) {
    const { t } = await this.access.loadEditable(orgId, templateId, p)
    if (t.status === 'draft') throw new BadRequestException('Only a live workflow can be paused.')
    if (t.status === 'active') {
      await this.prisma.workflowTemplate.updateMany({
        where: { id: templateId, organization_id: orgId, status: 'active' },
        data: { status: 'paused', updated_at: new Date() },
      })
    }
    return this.templateView.templateDetail(orgId, templateId, p)
  }

  /**
   * Resume a paused workflow. Occurrences missed while paused are NOT caught up: every
   * schedule's last-fired marker moves to now (org clock).
   */
  async resumeTemplate(orgId: string, templateId: string, p: Principal) {
    const { t } = await this.access.loadEditable(orgId, templateId, p)
    if (t.status === 'draft') throw new BadRequestException('This workflow is a draft. Save it to make it live.')
    if (t.status === 'paused') {
      const now = await this.clock.now(orgId)
      await this.prisma.$transaction(async (tx) => {
        const res = await tx.workflowTemplate.updateMany({
          where: { id: templateId, organization_id: orgId, status: 'paused' },
          data: { status: 'active', updated_at: new Date() },
        })
        if (res.count === 1) await markSchedulesFiredUpTo(tx, orgId, templateId, now)
      })
    }
    return this.templateView.templateDetail(orgId, templateId, p)
  }

  /** Archive (never a hard delete). Running runs carry on; nothing new starts. */
  async archiveTemplate(orgId: string, templateId: string, p: Principal) {
    await this.access.loadEditable(orgId, templateId, p, { allowArchived: true })
    await this.prisma.workflowTemplate.updateMany({
      where: { id: templateId, organization_id: orgId },
      data: { status: 'archived', updated_at: new Date() },
    })
    return this.templateView.templateDetail(orgId, templateId, p)
  }

  /** Restore an archived workflow — it comes back as a Draft. */
  async restoreTemplate(orgId: string, templateId: string, p: Principal) {
    const { t } = await this.access.loadEditable(orgId, templateId, p, { allowArchived: true })
    if (t.status !== 'archived') throw new BadRequestException('Only archived workflows can be restored.')
    await this.prisma.workflowTemplate.updateMany({
      where: { id: templateId, organization_id: orgId, status: 'archived' },
      data: { status: 'draft', updated_at: new Date() },
    })
    return this.templateView.templateDetail(orgId, templateId, p)
  }

  /**
   * `POST /:id/change-creator` — admins hand the permanent-editor role to another
   * ACTIVE member (e.g. the creator left). The new creator's own edit/view grants are
   * folded in; the previous creator stays an ordinary editor while still an active
   * member. Recorded in the audit log (the template update is captured).
   */
  async changeCreator(orgId: string, templateId: string, userId: string, p: Principal) {
    if (!isAdminPrincipal(p)) throw new ForbiddenException(MSG_CHANGE_CREATOR)
    const t = await this.prisma.workflowTemplate.findFirst({
      where: { id: templateId, organization_id: orgId },
      select: { id: true, created_by_user_id: true },
    })
    if (!t) throw new NotFoundException(MSG_NOT_FOUND)
    if (t.created_by_user_id === userId) return this.templateView.templateDetail(orgId, templateId, p)
    await assertActiveOrgMembers(this.prisma, orgId, [userId], 'the new creator')
    const previous = t.created_by_user_id
    const previousActive = (await this.access.activeMemberSet(orgId, [previous])).has(previous)
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.workflowTemplate.updateMany({
        where: { id: templateId, organization_id: orgId, created_by_user_id: previous },
        data: { created_by_user_id: userId, owner_user_ids: [userId], updated_at: new Date() },
      })
      if (res.count !== 1) throw new ConflictException('Someone else just changed this workflow. Reload and try again.')
      await tx.workflowAccess.deleteMany({
        where: { workflow_template_id: templateId, organization_id: orgId, user_id: userId, access_type: { in: ['edit', 'view'] } },
      })
      if (previousActive) {
        await tx.workflowAccess.createMany({
          data: [{ organization_id: orgId, workflow_template_id: templateId, user_id: previous, access_type: 'edit' }],
          skipDuplicates: true,
        })
      }
    })
    return this.templateView.templateDetail(orgId, templateId, p)
  }
}
