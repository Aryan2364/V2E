'use client';
import { EmployeeProfile } from '@/lib/types';

interface TreeNode {
  profile: EmployeeProfile;
  children: TreeNode[];
}

function buildTree(profiles: EmployeeProfile[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  profiles.forEach((p) => map.set(p.user_id, { profile: p, children: [] }));

  const roots: TreeNode[] = [];
  profiles.forEach((p) => {
    if (p.reporting_to_user_id && map.has(p.reporting_to_user_id)) {
      map.get(p.reporting_to_user_id)!.children.push(map.get(p.user_id)!);
    } else {
      roots.push(map.get(p.user_id)!);
    }
  });
  return roots;
}

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

function TreeNodeComponent({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  return (
    <div className={depth > 0 ? 'ml-8 border-l border-[#E2E8F0] pl-4' : ''}>
      <div className="flex items-center gap-3 py-2">
        <div className="w-8 h-8 rounded-full bg-[#2563EB] flex items-center justify-center text-white text-xs font-semibold shrink-0">
          {getInitials(node.profile.user?.name ?? 'U')}
        </div>
        <div>
          <div className="text-sm font-medium text-[#0F172A]">{node.profile.user?.name}</div>
          <div className="text-xs text-[#475569]">{node.profile.role?.title}</div>
        </div>
      </div>
      {node.children.map((child) => (
        <TreeNodeComponent key={child.profile.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export default function EmployeeTree({ profiles }: { profiles: EmployeeProfile[] }) {
  const roots = buildTree(profiles);
  if (!roots.length) {
    return <div className="text-[#94A3B8] text-sm text-center py-8">No employees added yet</div>;
  }
  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] p-4">
      <h3 className="text-[18px] font-semibold text-[#0F172A] mb-4">Reporting Structure</h3>
      {roots.map((root) => (
        <TreeNodeComponent key={root.profile.id} node={root} />
      ))}
    </div>
  );
}
