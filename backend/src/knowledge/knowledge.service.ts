import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateKnowledgePostDto } from './dto/create-knowledge-post.dto';
import { CreateKnowledgeCommentDto } from './dto/create-comment.dto';

const AUTHOR_SELECT = { id: true, name: true, email: true };

const POST_INCLUDE = {
  created_by: { select: AUTHOR_SELECT },
  department: { select: { id: true, name: true } },
  _count: { select: { comments: true } },
  reactions: { select: { emoji: true, user_id: true } },
};

@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    orgId: string,
    query: { scope?: string; tag?: string; search?: string; page?: string; pageSize?: string },
  ) {
    const where = {
      organization_id: orgId,
      ...(query.scope ? { scope: query.scope as any } : {}),
      ...(query.search ? {
        OR: [
          { title: { contains: query.search, mode: 'insensitive' as const } },
          { body: { contains: query.search, mode: 'insensitive' as const } },
        ],
      } : {}),
    };
    const orderBy = [{ is_pinned: 'desc' as const }, { created_at: 'desc' as const }];

    // Opt-in pagination (kit §11.1.1): omitting `page` returns the plain array,
    // byte-for-byte what the knowledge feed gets today.
    const page = query.page ? parseInt(query.page, 10) : undefined;
    if (!page) {
      return this.prisma.knowledgePost.findMany({ where, include: POST_INCLUDE, orderBy });
    }
    const take = Math.min(Math.max(query.pageSize ? parseInt(query.pageSize, 10) : 25, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;
    const [items, total] = await Promise.all([
      this.prisma.knowledgePost.findMany({ where, include: POST_INCLUDE, orderBy, skip, take }),
      this.prisma.knowledgePost.count({ where }),
    ]);
    return { items, total, page: Math.max(page, 1), pageSize: take };
  }

  async findOne(id: string, orgId: string) {
    const post = await this.prisma.knowledgePost.findFirst({
      where: { id, organization_id: orgId },
      include: {
        ...POST_INCLUDE,
        comments: {
          where: { parent_comment_id: null },
          include: {
            created_by: { select: AUTHOR_SELECT },
            replies: {
              include: { created_by: { select: AUTHOR_SELECT } },
              orderBy: { created_at: 'asc' },
            },
          },
          orderBy: { created_at: 'asc' },
        },
      },
    });
    if (!post) throw new NotFoundException(`Post ${id} not found`);
    return post;
  }

  async create(orgId: string, userId: string, dto: CreateKnowledgePostDto) {
    return this.prisma.knowledgePost.create({
      data: {
        ...dto,
        organization_id: orgId,
        created_by_user_id: userId,
        tags: dto.tags as any,
        attachment_urls: dto.attachment_urls as any,
      },
      include: POST_INCLUDE,
    });
  }

  async update(id: string, orgId: string, userId: string, isAdmin: boolean, dto: Partial<CreateKnowledgePostDto>) {
    const post = await this.findOneRaw(id, orgId);
    if (post.created_by_user_id !== userId && !isAdmin) {
      throw new ForbiddenException('Not allowed');
    }
    return this.prisma.knowledgePost.update({
      where: { id },
      data: { ...dto, tags: dto.tags as any, attachment_urls: dto.attachment_urls as any },
      include: POST_INCLUDE,
    });
  }

  async remove(id: string, orgId: string, userId: string, isAdmin: boolean) {
    const post = await this.findOneRaw(id, orgId);
    if (post.created_by_user_id !== userId && !isAdmin) {
      throw new ForbiddenException('Not allowed');
    }
    return this.prisma.knowledgePost.delete({ where: { id } });
  }

  async togglePin(id: string, orgId: string) {
    const post = await this.findOneRaw(id, orgId);
    return this.prisma.knowledgePost.update({ where: { id }, data: { is_pinned: !post.is_pinned } });
  }

  async addComment(postId: string, orgId: string, userId: string, dto: CreateKnowledgeCommentDto) {
    await this.findOneRaw(postId, orgId);
    return this.prisma.knowledgeComment.create({
      data: {
        ...dto,
        knowledge_post_id: postId,
        organization_id: orgId,
        created_by_user_id: userId,
      },
      include: { created_by: { select: AUTHOR_SELECT } },
    });
  }

  async deleteComment(commentId: string, orgId: string, userId: string, isAdmin: boolean) {
    const comment = await this.prisma.knowledgeComment.findFirst({ where: { id: commentId, organization_id: orgId } });
    if (!comment) throw new NotFoundException(`Comment ${commentId} not found`);
    if (comment.created_by_user_id !== userId && !isAdmin) {
      throw new ForbiddenException('Not allowed');
    }
    return this.prisma.knowledgeComment.delete({ where: { id: commentId } });
  }

  async toggleReaction(postId: string, orgId: string, userId: string, emoji: string) {
    await this.findOneRaw(postId, orgId);
    const existing = await this.prisma.knowledgeReaction.findUnique({
      where: { knowledge_post_id_user_id_emoji: { knowledge_post_id: postId, user_id: userId, emoji } },
    });
    if (existing) {
      await this.prisma.knowledgeReaction.delete({ where: { id: existing.id } });
      return { toggled: false, emoji };
    } else {
      await this.prisma.knowledgeReaction.create({
        data: { knowledge_post_id: postId, user_id: userId, emoji, organization_id: orgId },
      });
      return { toggled: true, emoji };
    }
  }

  async getTags(orgId: string) {
    const posts = await this.prisma.knowledgePost.findMany({
      where: { organization_id: orgId },
      select: { tags: true },
    });
    const tagSet = new Set<string>();
    for (const p of posts) {
      if (Array.isArray(p.tags)) p.tags.forEach((t: any) => tagSet.add(t));
    }
    return Array.from(tagSet).sort();
  }

  private async findOneRaw(id: string, orgId: string) {
    const post = await this.prisma.knowledgePost.findFirst({ where: { id, organization_id: orgId } });
    if (!post) throw new NotFoundException(`Post ${id} not found`);
    return post;
  }
}
