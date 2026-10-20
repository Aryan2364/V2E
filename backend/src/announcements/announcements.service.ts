import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { parsePagination } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

const AUTHOR_SELECT = {
  id: true, name: true, email: true,
};

const ANNOUNCEMENT_INCLUDE = {
  created_by: { select: AUTHOR_SELECT },
  department: { select: { id: true, name: true } },
  _count: { select: { reads: true } },
};

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(orgId: string, userId: string, query: {
    type?: string; scope?: string; priority?: string; pinned?: string; page?: string; pageSize?: string;
  }) {
    const now = new Date();
    const where = {
      organization_id: orgId,
      published_at: { not: null, lte: now },
      OR: [{ expires_at: null }, { expires_at: { gt: now } }],
      ...(query.type ? { type: query.type as any } : {}),
      ...(query.scope ? { scope: query.scope as any } : {}),
      ...(query.priority ? { priority: query.priority as any } : {}),
      ...(query.pinned === 'true' ? { is_pinned: true } : {}),
    };
    const include = {
      ...ANNOUNCEMENT_INCLUDE,
      reads: { where: { user_id: userId }, select: { read_at: true } },
    };
    const orderBy = [{ is_pinned: 'desc' as const }, { published_at: 'desc' as const }];

    // Opt-in pagination (kit §11.1.1): omitting `page` returns the plain array,
    // byte-for-byte what the announcements feed gets today.
    const { page, pageSize } = parsePagination(query.page, query.pageSize);
    if (page === undefined) {
      return this.prisma.announcement.findMany({ where, include, orderBy });
    }
    const take = pageSize ?? 25;
    const skip = (Math.max(page, 1) - 1) * take;
    const [items, total] = await Promise.all([
      this.prisma.announcement.findMany({ where, include, orderBy, skip, take }),
      this.prisma.announcement.count({ where }),
    ]);
    return { items, total, page: Math.max(page, 1), pageSize: take };
  }

  async findOne(id: string, orgId: string, userId: string) {
    const ann = await this.prisma.announcement.findFirst({
      where: { id, organization_id: orgId },
      include: {
        ...ANNOUNCEMENT_INCLUDE,
        reads: {
          include: { user: { select: AUTHOR_SELECT } },
          orderBy: { read_at: 'asc' },
        },
      },
    });
    if (!ann) throw new NotFoundException(`Announcement ${id} not found`);
    return ann;
  }

  async create(orgId: string, userId: string, dto: CreateAnnouncementDto) {
    return this.prisma.announcement.create({
      data: {
        ...dto,
        organization_id: orgId,
        created_by_user_id: userId,
        expires_at: dto.expires_at ? new Date(dto.expires_at) : undefined,
        attachment_urls: dto.attachment_urls as any,
      },
      include: ANNOUNCEMENT_INCLUDE,
    });
  }

  async update(id: string, orgId: string, userId: string, isAdmin: boolean, dto: UpdateAnnouncementDto) {
    const ann = await this.findOneRaw(id, orgId);
    if (ann.created_by_user_id !== userId && !isAdmin) {
      throw new ForbiddenException('Not allowed to edit this announcement');
    }
    return this.prisma.announcement.update({
      where: { id },
      data: {
        ...dto,
        expires_at: dto.expires_at ? new Date(dto.expires_at) : undefined,
        attachment_urls: dto.attachment_urls as any,
      },
      include: ANNOUNCEMENT_INCLUDE,
    });
  }

  async publish(id: string, orgId: string, userId: string, isAdmin: boolean) {
    const ann = await this.findOneRaw(id, orgId);
    if (ann.created_by_user_id !== userId && !isAdmin) {
      throw new ForbiddenException('Not allowed to publish this announcement');
    }
    return this.prisma.announcement.update({
      where: { id },
      data: { published_at: new Date() },
      include: ANNOUNCEMENT_INCLUDE,
    });
  }

  async togglePin(id: string, orgId: string) {
    const ann = await this.findOneRaw(id, orgId);
    return this.prisma.announcement.update({
      where: { id },
      data: { is_pinned: !ann.is_pinned },
      include: ANNOUNCEMENT_INCLUDE,
    });
  }

  async markRead(id: string, orgId: string, userId: string) {
    await this.findOneRaw(id, orgId);
    return this.prisma.announcementRead.upsert({
      where: { announcement_id_user_id: { announcement_id: id, user_id: userId } },
      create: { announcement_id: id, user_id: userId, organization_id: orgId },
      update: { read_at: new Date() },
    });
  }

  async getReadStatus(id: string, orgId: string) {
    const ann = await this.findOneRaw(id, orgId);
    const [reads, totalEmployees] = await Promise.all([
      this.prisma.announcementRead.findMany({
        where: { announcement_id: id },
        include: { user: { select: AUTHOR_SELECT } },
      }),
      this.prisma.organizationMember.count({ where: { organization_id: orgId, is_active: true } }),
    ]);
    return { total_employees: totalEmployees, read_count: reads.length, reads };
  }

  async remove(id: string, orgId: string, userId: string, isAdmin: boolean) {
    const ann = await this.findOneRaw(id, orgId);
    if (ann.created_by_user_id !== userId && !isAdmin) {
      throw new ForbiddenException('Not allowed to delete this announcement');
    }
    return this.prisma.announcement.delete({ where: { id } });
  }

  private async findOneRaw(id: string, orgId: string) {
    const ann = await this.prisma.announcement.findFirst({ where: { id, organization_id: orgId } });
    if (!ann) throw new NotFoundException(`Announcement ${id} not found`);
    return ann;
  }
}
