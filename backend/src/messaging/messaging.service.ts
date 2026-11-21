import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConversationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';

const USER_SELECT = { id: true, name: true, email: true };

@Injectable()
export class MessagingService {
  constructor(private readonly prisma: PrismaService) {}

  async getConversations(userId: string, orgId: string) {
    const memberships = await this.prisma.conversationMember.findMany({
      where: { user_id: userId, organization_id: orgId },
      include: {
        conversation: {
          include: {
            members: { include: { user: { select: USER_SELECT } } },
            messages: {
              orderBy: { created_at: 'desc' },
              take: 1,
              include: { sender: { select: USER_SELECT } },
            },
          },
        },
      },
      orderBy: { conversation: { updated_at: 'desc' } },
    });

    return memberships.map((m) => {
      const conv = m.conversation;
      const unread = conv.messages.filter(
        (msg) => msg.created_at > m.last_read_at && msg.sender_user_id !== userId,
      ).length;

      let displayName = conv.name;
      if (!displayName && conv.type === 'direct') {
        const other = conv.members.find((mem) => mem.user_id !== userId);
        displayName = other?.user.name ?? 'Direct Message';
      }

      return {
        ...conv,
        display_name: displayName,
        last_message: conv.messages[0] ?? null,
        unread_count: unread,
        my_membership: m,
      };
    });
  }

  async getConversation(id: string, userId: string, orgId: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id, organization_id: orgId },
      include: {
        members: { include: { user: { select: USER_SELECT } } },
      },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    const isMember = conv.members.some((m) => m.user_id === userId);
    if (!isMember) throw new ForbiddenException('Not a member of this conversation');
    return conv;
  }

  async createConversation(userId: string, orgId: string, dto: CreateConversationDto) {
    const allUserIds = [...new Set([userId, ...dto.user_ids])];

    // For DM: check if conversation already exists between the 2 users
    if (dto.type === ConversationType.direct && allUserIds.length === 2) {
      const existing = await this.prisma.conversation.findFirst({
        where: {
          organization_id: orgId,
          type: 'direct',
          AND: allUserIds.map((uid) => ({
            members: { some: { user_id: uid } },
          })),
        },
        include: {
          members: { include: { user: { select: USER_SELECT } } },
        },
      });
      if (existing) return existing;
    }

    return this.prisma.conversation.create({
      data: {
        organization_id: orgId,
        type: dto.type,
        name: dto.name,
        created_by_user_id: userId,
        members: {
          create: allUserIds.map((uid) => ({
            user_id: uid,
            organization_id: orgId,
            role: uid === userId ? 'admin' : 'member',
          })),
        },
      },
      include: { members: { include: { user: { select: USER_SELECT } } } },
    });
  }

  async addMembers(convId: string, userId: string, orgId: string, userIds: string[]) {
    await this.getConversation(convId, userId, orgId);
    await this.prisma.conversationMember.createMany({
      data: userIds.map((uid) => ({
        conversation_id: convId,
        user_id: uid,
        organization_id: orgId,
      })),
      skipDuplicates: true,
    });
    return this.getConversation(convId, userId, orgId);
  }

  async removeMember(convId: string, actorId: string, orgId: string, targetUserId: string) {
    await this.getConversation(convId, actorId, orgId);
    return this.prisma.conversationMember.deleteMany({
      where: { conversation_id: convId, user_id: targetUserId },
    });
  }

  async getMessages(convId: string, userId: string, orgId: string, cursor?: string) {
    await this.getConversation(convId, userId, orgId);
    return this.prisma.message.findMany({
      where: { conversation_id: convId, organization_id: orgId },
      include: {
        sender: { select: USER_SELECT },
        reply_to_message: {
          select: { id: true, body: true, sender: { select: USER_SELECT } },
        },
      },
      orderBy: { created_at: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: 50,
    });
  }

  async sendMessage(convId: string, userId: string, orgId: string, dto: SendMessageDto) {
    await this.getConversation(convId, userId, orgId);
    const message = await this.prisma.message.create({
      data: {
        conversation_id: convId,
        sender_user_id: userId,
        organization_id: orgId,
        body: dto.body,
        reply_to_message_id: dto.reply_to_message_id,
        attachment_urls: dto.attachment_urls as any,
      },
      include: {
        sender: { select: USER_SELECT },
        reply_to_message: {
          select: { id: true, body: true, sender: { select: USER_SELECT } },
        },
      },
    });

    // Bump conversation updated_at
    await this.prisma.conversation.update({
      where: { id: convId },
      data: { updated_at: new Date() },
    });

    return message;
  }

  async editMessage(msgId: string, convId: string, userId: string, orgId: string, body: string) {
    const msg = await this.prisma.message.findFirst({
      where: { id: msgId, conversation_id: convId, organization_id: orgId },
    });
    if (!msg) throw new NotFoundException('Message not found');
    if (msg.sender_user_id !== userId) throw new ForbiddenException('Not allowed');
    return this.prisma.message.update({
      where: { id: msgId },
      data: { body },
      include: { sender: { select: USER_SELECT } },
    });
  }

  async deleteMessage(msgId: string, convId: string, userId: string, orgId: string) {
    const msg = await this.prisma.message.findFirst({
      where: { id: msgId, conversation_id: convId, organization_id: orgId },
    });
    if (!msg) throw new NotFoundException('Message not found');
    if (msg.sender_user_id !== userId) {
      const member = await this.prisma.organizationMember.findUnique({
        where: { organization_id_user_id: { organization_id: orgId, user_id: userId } },
        select: { is_admin: true },
      });
      if (!member?.is_admin) throw new ForbiddenException('Not allowed');
    }
    return this.prisma.message.update({
      where: { id: msgId },
      data: { body: '', is_deleted: true },
    });
  }

  async markRead(convId: string, userId: string, orgId: string) {
    await this.prisma.conversationMember.updateMany({
      where: { conversation_id: convId, user_id: userId },
      data: { last_read_at: new Date() },
    });
    return { success: true };
  }
}
