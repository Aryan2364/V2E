import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { memTable } from '../common/testing/mem-table';

const ORG = 'org-1';
const OTHER = 'org-2';

function setup() {
  const posts = memTable<any>([{ id: 'post-1', organization_id: ORG, created_by_user_id: 'u-author', is_pinned: false }]);
  const comments = memTable<any>([{ id: 'c-1', organization_id: ORG, knowledge_post_id: 'post-1', created_by_user_id: 'u-author' }]);
  const prisma: any = {
    knowledgePost: posts,
    knowledgeComment: comments,
    knowledgeReaction: { findUnique: jest.fn(async () => null), create: jest.fn(async () => ({})), delete: jest.fn() },
    department: memTable<any>([{ id: 'd-1', organization_id: OTHER }]),
  };
  return { svc: new KnowledgeService(prisma), posts, comments };
}

describe('KnowledgeService object-level authorization', () => {
  it('another org cannot read, edit, delete, pin or comment on a post', async () => {
    const { svc } = setup();
    await expect(svc.findOne('post-1', OTHER)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.update('post-1', OTHER, 'u-x', true, { body: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.remove('post-1', OTHER, 'u-x', true)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.togglePin('post-1', OTHER)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.addComment('post-1', OTHER, 'u-x', { body: 'x' } as any)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.deleteComment('c-1', OTHER, 'u-x', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a same-org non-author non-admin cannot edit or delete a post or comment', async () => {
    const { svc, posts } = setup();
    await expect(svc.update('post-1', ORG, 'u-peer', false, { body: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.remove('post-1', ORG, 'u-peer', false)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.deleteComment('c-1', ORG, 'u-peer', false)).rejects.toBeInstanceOf(ForbiddenException);
    expect(posts.rows).toHaveLength(1);
  });

  it("a post cannot be filed under another org's department", async () => {
    const { svc } = setup();
    await expect(svc.create(ORG, 'u-author', { body: 'x', department_id: 'd-1' } as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});
