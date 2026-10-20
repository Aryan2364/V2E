'use client'

import { Trash2 } from 'lucide-react'
import StyledSelect from '@/components/ui/StyledSelect'
import type { ProjectMember, ProjectMemberRole, TaskVisibility } from '@/lib/types/projects'
import { Button } from '@/components/ui/button'
import Tooltip from '@/components/ui/tooltip'

interface MemberRowProps {
  member: ProjectMember
  currentUserId: string
  canEdit: boolean
  onRoleChange: (userId: string, role: ProjectMemberRole) => void
  onVisibilityChange: (userId: string, visibility: TaskVisibility) => void
  onRemove: (userId: string) => void
}

export default function MemberRow({ member, currentUserId, canEdit, onRoleChange, onVisibilityChange, onRemove }: MemberRowProps) {
  const isSelf = member.user_id === currentUserId

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border-light last:border-0">
      <div className="w-8 h-8 rounded-full bg-primary-subtle border border-primary-border flex items-center justify-center shrink-0">
        <span className="text-meta font-medium text-primary-text">{member.user_id.charAt(0).toUpperCase()}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-body font-medium text-text-primary truncate">{member.user_id}</p>
        {isSelf && <p className="text-meta text-text-muted">You</p>}
      </div>
      {canEdit && !isSelf ? (
        <>
          <StyledSelect
            value={member.role}
            onChange={(v) => onRoleChange(member.user_id, v as ProjectMemberRole)}
            size="sm"
            wrapperClassName="w-[110px]"
            options={[
              { value: 'manager', label: 'Manager' },
              { value: 'editor', label: 'Editor' },
              { value: 'viewer', label: 'Viewer' },
            ]}
          />
          <StyledSelect
            value={member.task_visibility}
            onChange={(v) => onVisibilityChange(member.user_id, v as TaskVisibility)}
            size="sm"
            wrapperClassName="w-[120px]"
            options={[
              { value: 'own_tasks_only', label: 'Own tasks' },
              { value: 'all_member_tasks', label: 'All tasks' },
            ]}
          />
          <Tooltip label="Remove member">
            <Button type="button" variant="ghost" size="icon" onClick={() => onRemove(member.user_id)} aria-label="Remove member">
              <Trash2 size={14} />
            </Button>
          </Tooltip>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-meta px-2 py-0.5 rounded-full border border-border-light text-text-secondary capitalize">{member.role}</span>
          <span className="text-meta text-text-muted">{member.task_visibility === 'all_member_tasks' ? 'All tasks' : 'Own tasks'}</span>
        </div>
      )}
    </div>
  )
}
