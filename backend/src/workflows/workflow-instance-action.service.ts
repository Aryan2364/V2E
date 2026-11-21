import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { INSTANCE_NAME_MAX, instanceNameTaken } from './workflow-engine.shared'
import { IN_FLIGHT, MSG_ARCHIVED_START, MSG_DRAFT_START, MSG_NAME_REQUIRED, MSG_NAME_TOO_LONG, MSG_NOT_FOUND, MSG_PAUSED, MSG_RUN_NOT_FOUND, MSG_SCHEDULE_ONLY, MSG_SEND_BACK, MSG_TRIGGER, MSG_VIEW, SEND_BACK_FROM, accessSelect } from './workflow-template.types'
import { MANUAL_START } from './engine/schedule'
import { Principal } from '../access-rights/permissions.service'
import { PrismaService } from '../prisma/prisma.service'
import { SendBackDto } from './dto/run-actions.dto'
import { WorkflowAccessService } from './workflow-access.service'
import { WorkflowEngineService } from './workflow-engine.service'
import { WorkflowInstanceQueryService } from './workflow-instance-query.service'
import { WorkflowRunActionsService } from './workflow-run-actions.service'
import { capabilitiesFor } from './workflow-access'
import { instanceNameKey, tidyInstanceName } from './run-access'
import { rowDependencyMap, sendBackTargets } from './step-graph'
import { rowLabels, rowOf, stepTitle } from './workflow-view.formatter'

/** Instance actions by people: start a run, cancel, retry, skip, start now, send back. State changes are delegated to the engine. */
@Injectable()
export class WorkflowInstanceActionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: WorkflowEngineService,
    private readonly runActions: WorkflowRunActionsService,
    private readonly access: WorkflowAccessService,
    private readonly instanceQuery: WorkflowInstanceQueryService,
  ) {}

  /**
   * Run (start an instance by hand). Only while Live (not paused), only when "Manually"
   * is on, and only by the people chosen under "Manually" — a starter may run it
   * without design access. The instance name is required (trimmed, inner spaces
   * collapsed, 1–80 characters) and unique within the workflow, case- and space-
   * insensitively; every name error is a 400 `{ message, code, field: 'name' }`. The
   * engine re-checks the name under the workflow's lock (authoritative).
   */
  async triggerInstance(orgId: string, templateId: string, name: string | undefined, p: Principal) {
    const t = await this.prisma.workflowTemplate.findFirst({
      where: { id: templateId, organization_id: orgId },
      select: accessSelect(p.userId),
    })
    if (!t) throw new NotFoundException(MSG_NOT_FOUND)
    const caps = capabilitiesFor(t, p)
    if (!caps.can_view && !caps.is_starter) throw new ForbiddenException(MSG_VIEW)
    if (t.status === 'archived') throw new BadRequestException(MSG_ARCHIVED_START)
    if (t.status === 'draft') throw new BadRequestException(MSG_DRAFT_START)
    if (t.status === 'paused') throw new BadRequestException(MSG_PAUSED)
    if (t.manual_start_enabled === false) throw new BadRequestException(MSG_SCHEDULE_ONLY)
    if (!caps.can_trigger) throw new ForbiddenException(MSG_TRIGGER)
    const typed = tidyInstanceName(typeof name === 'string' ? name : '')
    if (!typed) {
      throw new BadRequestException({ message: MSG_NAME_REQUIRED, code: 'instance_name_required', field: 'name' })
    }
    if (typed.length > INSTANCE_NAME_MAX) {
      throw new BadRequestException({ message: MSG_NAME_TOO_LONG, code: 'instance_name_too_long', field: 'name' })
    }
    const clash = await this.prisma.workflowInstance.findFirst({
      where: { workflow_template_id: templateId, organization_id: orgId, name_key: instanceNameKey(typed) },
      select: { id: true },
    })
    if (clash) throw instanceNameTaken()
    const created = await this.engine.createInstance(orgId, templateId, MANUAL_START, { name: typed }, p.userId)
    return this.instanceQuery.instanceDetail(orgId, templateId, created.id, p)
  }

  /** Run actions need `can_edit` on the template; the engine owns all state changes. */
  private async loadRunAction(orgId: string, templateId: string, instanceId: string, p: Principal) {
    await this.access.loadEditable(orgId, templateId, p, { allowArchived: true })
    const inst = await this.prisma.workflowInstance.findFirst({
      where: { id: instanceId, workflow_template_id: templateId, organization_id: orgId },
      select: { id: true },
    })
    if (!inst) throw new NotFoundException(MSG_RUN_NOT_FOUND)
  }

  async cancelInstance(orgId: string, templateId: string, instanceId: string, p: Principal) {
    await this.loadRunAction(orgId, templateId, instanceId, p)
    await this.runActions.cancelInstance(orgId, instanceId, p.userId)
    return this.instanceQuery.instanceDetail(orgId, templateId, instanceId, p)
  }

  async retryInstance(orgId: string, templateId: string, instanceId: string, p: Principal) {
    await this.loadRunAction(orgId, templateId, instanceId, p)
    await this.runActions.retryInstance(orgId, instanceId, p.userId)
    return this.instanceQuery.instanceDetail(orgId, templateId, instanceId, p)
  }

  /** Skip one step (`row_id`), or the single current step when omitted. */
  async skipStep(orgId: string, templateId: string, instanceId: string, rowId: string | undefined, p: Principal) {
    await this.loadRunAction(orgId, templateId, instanceId, p)
    if (rowId) {
      const row = await this.prisma.workflowInstanceStep.findFirst({
        where: { id: rowId, workflow_instance_id: instanceId, organization_id: orgId },
        select: { id: true },
      })
      if (!row) throw new NotFoundException('Step not found in this instance')
    }
    await this.runActions.skipStep(orgId, instanceId, p.userId, rowId)
    return this.instanceQuery.instanceDetail(orgId, templateId, instanceId, p)
  }

  /**
   * "Start now" (`can_edit`): a waiting row starts immediately. The row is scoped to
   * this run + org (404 otherwise); the engine re-checks it is waiting inside its
   * transaction.
   */
  async startStepNow(orgId: string, templateId: string, instanceId: string, rowId: string, p: Principal) {
    await this.loadRunAction(orgId, templateId, instanceId, p)
    const row = await this.prisma.workflowInstanceStep.findFirst({
      where: { id: rowId, workflow_instance_id: instanceId, organization_id: orgId },
      select: { id: true },
    })
    if (!row) throw new NotFoundException('Step not found in this instance')
    await this.runActions.startStepNow(orgId, instanceId, rowId, p.userId)
    return this.instanceQuery.instanceDetail(orgId, templateId, instanceId, p)
  }

  /**
   * Completed steps upstream of `rowId` (direct predecessors first) — where a send
   * back from it may go. Run view is enough to read them.
   */
  async getSendBackTargets(orgId: string, templateId: string, instanceId: string, rowId: string, p: Principal) {
    const { inst } = await this.access.loadInstance(orgId, templateId, instanceId, p)
    rowOf(inst, rowId)
    const deps = rowDependencyMap(inst.steps)
    const direct = new Set(deps.get(rowId) ?? [])
    const labels = rowLabels(inst, deps)
    return sendBackTargets(inst.steps, deps, rowId).map(({ row }) => ({
      row_id: row.id,
      title: stepTitle(row),
      /** "1", "B2". */
      number_label: labels.get(row.id) ?? null,
      is_direct: direct.has(row.id),
    }))
  }

  /**
   * Send the run back from `rowId` to an earlier completed step, with a reason. The
   * step's own (non-CC) assignees or people who can change the workflow may do it;
   * the target must be a completed step upstream of it. The engine re-checks every
   * precondition inside its transaction.
   */
  async sendBack(orgId: string, templateId: string, instanceId: string, rowId: string, dto: SendBackDto, p: Principal) {
    const { inst, caps } = await this.access.loadInstance(orgId, templateId, instanceId, p)
    const row = rowOf(inst, rowId)
    if (!IN_FLIGHT.includes(inst.status)) throw new BadRequestException('This instance has finished, so it can’t be sent back.')
    if (!caps.can_edit && !(await this.access.isRowWorker(orgId, row.task_id, p.userId))) {
      throw new ForbiddenException(MSG_SEND_BACK)
    }
    if (!SEND_BACK_FROM.includes(row.status)) {
      throw new BadRequestException('Only a step that is in progress can be sent back.')
    }
    const targets = sendBackTargets(inst.steps, rowDependencyMap(inst.steps), rowId)
    if (!targets.some((t) => t.row.id === dto.to_row_id)) {
      throw new BadRequestException('You can only send it back to an earlier step that is done.')
    }
    await this.runActions.sendBack(orgId, instanceId, rowId, dto.to_row_id, dto.reason.trim(), p.userId, {
      canEdit: caps.can_edit,
    })
    return this.instanceQuery.instanceDetail(orgId, templateId, instanceId, p)
  }
}
