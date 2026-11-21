import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BoardInteractionMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { CreateBulletinPostDto } from './dto/create-post.dto';
import { CreateBulletinCommentDto } from './dto/create-comment.dto';

const AUTHOR_SELECT = { id: true, name: true, email: true };
const BOARD_INCLUDE = {
  department: { select: { id: true, name: true } },
  created_by: { select: AUTHOR_SELECT },
  _count: { select: { posts: true } },
};

@Injectable()
export class BulletinService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Boards ────────────────────────────────────────────────────────────────

  async findAllBoards(orgId: string) {
    return this.prisma.bulletinBoard.findMany({
      where: { organization_id: orgId, is_active: true },
      include: BOARD_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
  }

  async findBoard(boardId: string, orgId: string) {
    const board = await this.prisma.bulletinBoard.findFirst({
      where: { id: boardId, organization_id: orgId },
      include: BOARD_INCLUDE,
    });
    if (!board) throw new NotFoundException('Board not found');
    return board;
  }

  async createBoard(orgId: string, userId: string, dto: CreateBoardDto) {
    return this.prisma.bulletinBoard.create({
      data: { ...dto, organization_id: orgId, created_by_user_id: userId },
      include: BOARD_INCLUDE,
    });
  }

  async updateBoard(boardId: string, orgId: string, dto: Partial<CreateBoardDto>) {
    await this.findBoard(boardId, orgId);
    return this.prisma.bulletinBoard.update({
      where: { id: boardId },
      data: dto,
      include: BOARD_INCLUDE,
    });
  }

  async deleteBoard(boardId: string, orgId: string) {
    await this.findBoard(boardId, orgId);
    return this.prisma.bulletinBoard.update({
      where: { id: boardId },
      data: { is_active: false },
    });
  }

  // ─── Posts ─────────────────────────────────────────────────────────────────

  async findPosts(boardId: string, orgId: string) {
    await this.findBoard(boardId, orgId);
    return this.prisma.bulletinPost.findMany({
      where: { bulletin_board_id: boardId, organization_id: orgId },
      include: {
        created_by: { select: AUTHOR_SELECT },
        _count: { select: { comments: true, reactions: true } },
        reactions: {
          select: { emoji: true, user_id: true },
        },
      },
      orderBy: [{ is_pinned: 'desc' }, { created_at: 'desc' }],
    });
  }

  async findPost(postId: string, boardId: string, orgId: string) {
    const post = await this.prisma.bulletinPost.findFirst({
      where: { id: postId, bulletin_board_id: boardId, organization_id: orgId },
      include: {
        created_by: { select: AUTHOR_SELECT },
        comments: {
          include: { created_by: { select: AUTHOR_SELECT } },
          orderBy: { created_at: 'asc' },
        },
        reactions: { select: { emoji: true, user_id: true } },
      },
    });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  async createPost(boardId: string, orgId: string, userId: string, dto: CreateBulletinPostDto) {
    await this.findBoard(boardId, orgId);
    return this.prisma.bulletinPost.create({
      data: {
        ...dto,
        bulletin_board_id: boardId,
        organization_id: orgId,
        created_by_user_id: userId,
        attachment_urls: dto.attachment_urls as any,
      },
      include: { created_by: { select: AUTHOR_SELECT } },
    });
  }

  async updatePost(postId: string, boardId: string, orgId: string, userId: string, dto: Partial<CreateBulletinPostDto>) {
    const post = await this.prisma.bulletinPost.findFirst({ where: { id: postId, bulletin_board_id: boardId } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.created_by_user_id !== userId) throw new ForbiddenException('Not allowed');
    return this.prisma.bulletinPost.update({
      where: { id: postId },
      data: { ...dto, attachment_urls: dto.attachment_urls as any },
      include: { created_by: { select: AUTHOR_SELECT } },
    });
  }

  async deletePost(postId: string, boardId: string, orgId: string, userId: string, isAdmin: boolean) {
    const post = await this.prisma.bulletinPost.findFirst({ where: { id: postId, bulletin_board_id: boardId } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.created_by_user_id !== userId && !isAdmin) {
      throw new ForbiddenException('Not allowed');
    }
    return this.prisma.bulletinPost.delete({ where: { id: postId } });
  }

  async togglePin(postId: string, boardId: string, orgId: string) {
    const post = await this.prisma.bulletinPost.findFirst({
      where: { id: postId, bulletin_board_id: boardId, organization_id: orgId },
    });
    if (!post) throw new NotFoundException('Post not found');
    return this.prisma.bulletinPost.update({ where: { id: postId }, data: { is_pinned: !post.is_pinned } });
  }

  // ─── Comments ──────────────────────────────────────────────────────────────

  async addComment(postId: string, orgId: string, userId: string, dto: CreateBulletinCommentDto) {
    const post = await this.prisma.bulletinPost.findFirst({
      where: { id: postId, organization_id: orgId },
      include: { bulletin_board: true },
    });
    if (!post) throw new NotFoundException('Post not found');
    if (post.bulletin_board.interaction_mode === BoardInteractionMode.read_only) {
      throw new ForbiddenException('This board is read-only');
    }
    return this.prisma.bulletinComment.create({
      data: { ...dto, bulletin_post_id: postId, organization_id: orgId, created_by_user_id: userId },
      include: { created_by: { select: AUTHOR_SELECT } },
    });
  }

  async deleteComment(commentId: string, orgId: string, userId: string, isAdmin: boolean) {
    const comment = await this.prisma.bulletinComment.findFirst({ where: { id: commentId, organization_id: orgId } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.created_by_user_id !== userId && !isAdmin) {
      throw new ForbiddenException('Not allowed');
    }
    return this.prisma.bulletinComment.delete({ where: { id: commentId } });
  }

  // ─── Reactions ─────────────────────────────────────────────────────────────

  async toggleReaction(postId: string, orgId: string, userId: string, emoji: string) {
    const post = await this.prisma.bulletinPost.findFirst({
      where: { id: postId, organization_id: orgId },
      include: { bulletin_board: true },
    });
    if (!post) throw new NotFoundException('Post not found');
    if (post.bulletin_board.interaction_mode === BoardInteractionMode.read_only ||
        post.bulletin_board.interaction_mode === BoardInteractionMode.comments_only) {
      throw new ForbiddenException('Reactions not allowed on this board');
    }

    const existing = await this.prisma.bulletinReaction.findUnique({
      where: { bulletin_post_id_user_id_emoji: { bulletin_post_id: postId, user_id: userId, emoji } },
    });

    if (existing) {
      await this.prisma.bulletinReaction.delete({ where: { id: existing.id } });
      return { toggled: false, emoji };
    } else {
      await this.prisma.bulletinReaction.create({
        data: { bulletin_post_id: postId, user_id: userId, emoji, organization_id: orgId },
      });
      return { toggled: true, emoji };
    }
  }

  async getReactions(postId: string, orgId: string) {
    const reactions = await this.prisma.bulletinReaction.findMany({
      where: { bulletin_post_id: postId, organization_id: orgId },
      include: { user: { select: { id: true, name: true } } },
    });
    const grouped: Record<string, any[]> = {};
    for (const r of reactions) {
      if (!grouped[r.emoji]) grouped[r.emoji] = [];
      grouped[r.emoji].push(r.user);
    }
    return grouped;
  }
}
