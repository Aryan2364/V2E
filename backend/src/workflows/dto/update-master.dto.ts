import { WorkflowDefaultOverdue } from '@prisma/client'
import { IsEnum } from 'class-validator'

/** Org-level workflow defaults (admin only). New steps default their overdue action to this. */
export class UpdateMasterDto {
  @IsEnum(WorkflowDefaultOverdue, { message: 'Default overdue action must be block_next or proceed_anyway.' })
  default_overdue_action: WorkflowDefaultOverdue
}
