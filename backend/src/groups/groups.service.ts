import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.organizationGroup.findMany({
      include: {
        _count: { select: { organizations: true } },
        organizations: { select: { id: true, name: true, slug: true, status: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: string) {
    const group = await this.prisma.organizationGroup.findUnique({
      where: { id },
      include: {
        organizations: {
          select: {
            id: true, name: true, slug: true, status: true, industry: true, country: true,
            _count: { select: { members: true } },
          },
          orderBy: { created_at: 'asc' },
        },
      },
    });
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  async create(dto: CreateGroupDto) {
    let slug: string;
    if (dto.slug?.trim()) {
      slug = dto.slug.trim();
      const existing = await this.prisma.organizationGroup.findUnique({ where: { slug } });
      if (existing) throw new ConflictException(`Slug '${slug}' is already taken`);
    } else {
      // Slug is an internal identifier — derive it from the name and guarantee
      // uniqueness, exactly like organizations do.
      slug = await this.generateUniqueSlug(dto.name);
    }
    return this.prisma.organizationGroup.create({
      data: { name: dto.name, slug, description: dto.description },
    });
  }

  /**
   * Turn a group name into a URL-safe slug and ensure it's unique by appending
   * a numeric suffix (`rgb-group`, `rgb-group-2`, …) on collision.
   */
  private async generateUniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'group';

    let candidate = base;
    let n = 2;
    // eslint-disable-next-line no-await-in-loop
    while (await this.prisma.organizationGroup.findUnique({ where: { slug: candidate } })) {
      candidate = `${base}-${n++}`;
    }
    return candidate;
  }

  async update(id: string, dto: UpdateGroupDto) {
    await this.findOne(id);
    return this.prisma.organizationGroup.update({ where: { id }, data: dto });
  }

  async addOrg(groupId: string, orgId: string) {
    await this.findOne(groupId);
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');
    return this.prisma.organization.update({
      where: { id: orgId },
      data: { group_id: groupId },
      select: { id: true, name: true, group_id: true },
    });
  }

  async removeOrg(groupId: string, orgId: string) {
    await this.findOne(groupId);
    return this.prisma.organization.update({
      where: { id: orgId },
      data: { group_id: null },
      select: { id: true, name: true, group_id: true },
    });
  }

  async getGroupUsers(groupId: string) {
    await this.findOne(groupId);
    const members = await this.prisma.organizationMember.findMany({
      where: { organization: { group_id: groupId }, is_active: true },
      include: {
        user: { select: { id: true, name: true, email: true } },
        organization: { select: { id: true, name: true } },
      },
      orderBy: { user: { name: 'asc' } },
    });

    // Deduplicate by user_id, collecting all orgs per user.
    // NOTE: frontend consumers key on `user_id` (org-create admin picker, group users table),
    // so expose the user's id as `user_id` — not the raw `id` from the user select.
    const userMap = new Map<string, { user_id: string; name: string; email: string | null; orgs: { id: string; name: string; is_admin: boolean }[] }>();
    for (const m of members) {
      if (!userMap.has(m.user_id)) {
        userMap.set(m.user_id, { user_id: m.user.id, name: m.user.name, email: m.user.email ?? '', orgs: [] });
      }
      userMap.get(m.user_id)!.orgs.push({ id: m.organization.id, name: m.organization.name, is_admin: m.is_admin });
    }
    return Array.from(userMap.values());
  }
}
