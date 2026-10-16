'use client';
import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Users, Pencil } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';

export interface DeptNodeData {
  name: string;
  headName?: string;
  roleCount?: number;
  teamCount?: number;
  readOnly?: boolean;
  canEdit?: boolean;
  highlighted?: boolean;
  onEdit?: () => void;
  colors?: { fill: string; text: string; border: string; base: string };
}

function DeptNode({ data, selected }: { data: DeptNodeData; selected: boolean }) {
  const fill = data.colors?.fill ?? '#FFFFFF';
  const text = data.colors?.text ?? '#0F172A';
  const border = data.highlighted
    ? '#F59E0B'
    : selected
    ? '#2563EB'
    : data.colors?.border ?? '#E2E8F0';

  return (
    <div
      className={`group relative flex flex-col rounded-xl border-2 p-4 w-[200px] h-[120px] shadow-xs transition-all ${
        data.highlighted ? 'ring-2 ring-[#FCD34D]' : selected ? 'ring-2 ring-[#2563EB]/40' : ''
      }`}
      style={{ backgroundColor: fill, color: text, borderColor: border }}
    >
      <Handle type="target" position={Position.Top} className="bg-[#64748B]! w-3! h-3!" />

      {data.canEdit && data.onEdit && (
        <button
          type="button"
          className="nodrag absolute top-1.5 right-1.5 w-6 h-6 rounded-[6px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-white/25"
          style={{ color: text }}
          aria-label="Edit department"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            data.onEdit?.();
          }}
        >
          <Pencil size={13} />
        </button>
      )}

      <Tooltip label={data.name}>
      <div className="font-semibold text-sm pr-6 line-clamp-2 wrap-break-word">
        {data.name}
      </div>
      </Tooltip>
      {/* Always reserve the head line so a box with no head is the same height
          as one with a head. */}
      <Tooltip label={data.headName || undefined}>
      <div className="text-xs mt-1 h-4 truncate" style={{ opacity: 0.8 }}>
        {data.headName || ''}
      </div>
      </Tooltip>
      <div className="flex items-center gap-1 mt-auto pt-2">
        <Users size={12} style={{ opacity: 0.75 }} />
        <span className="text-xs" style={{ opacity: 0.85 }}>
          {data.teamCount ?? 0} members
        </span>
        {data.roleCount !== undefined && (
          <span
            className="ml-auto text-xs px-2 py-0.5 rounded-full font-medium bg-white/25"
            style={{ color: text }}
          >
            {data.roleCount} roles
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="bg-[#64748B]! w-3! h-3!" />
    </div>
  );
}

export default memo(DeptNode);
