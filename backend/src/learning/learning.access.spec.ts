import { NotFoundException } from '@nestjs/common';
import { LearningService } from './learning.service';
import { memTable } from '../common/testing/mem-table';

const ORG = 'org-1';
const OTHER = 'org-2';

function setup() {
  const paths = memTable<any>([{ id: 'lp-1', organization_id: ORG, status: 'draft' }]);
  const items = memTable<any>([{ id: 'li-1', path_id: 'lp-1', storage_key: null, preview_storage_key: null }]);
  const prisma: any = {
    learningPath: paths,
    learningItem: items,
    role: memTable<any>([{ id: 'r-foreign', organization_id: OTHER }]),
    department: memTable<any>([]),
    // Assignment rows are matched through a relation filter (path.organization_id) that
    // the in-memory table does not model, so model it explicitly: only the owner in ORG.
    learningPathAssignment: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === 'as-1' && where.employee_profile_id === 'p-owner' && where.path?.organization_id === ORG
          ? { id: 'as-1', path_id: 'lp-1', path: { mode: 'free' } }
          : null,
      ),
    },
  };
  return { svc: new LearningService(prisma, { delete: jest.fn() } as any), paths };
}

describe('LearningService object-level authorization', () => {
  it('another org cannot read, edit, archive or delete a path or its items', async () => {
    const { svc, paths } = setup();
    await expect(svc.findOnePath('lp-1', OTHER)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.updatePath('lp-1', OTHER, { title: 'x' } as any)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.archivePath('lp-1', OTHER)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.deleteItem('lp-1', 'li-1', OTHER)).rejects.toBeInstanceOf(NotFoundException);
    expect(paths.rows[0].status).toBe('draft');
  });

  it("a same-org employee cannot open or progress someone else's assignment", async () => {
    const { svc } = setup();
    await expect(svc.getMyAssignment('as-1', 'p-peer', ORG)).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      svc.completeItem('as-1', 'li-1', 'p-peer', ORG, { completion_type: 'manual' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.uncompleteItem('as-1', 'li-1', 'p-peer', ORG)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("a path cannot target another org's role", async () => {
    const { svc } = setup();
    await expect(svc.createPath(ORG, 'u-1', { title: 'x', role_id: 'r-foreign' } as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});
