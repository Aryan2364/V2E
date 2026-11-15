import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectTemplateDto } from './dto/create-project-template.dto';

@Injectable()
export class ProjectTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  private async findOrFail(orgId: string, templateId: string) {
    const t = await this.prisma.projectTemplate.findFirst({
      where: { id: templateId, organization_id: orgId, is_active: true },
      include: {
        milestones: { orderBy: { order_index: 'asc' } },
        tasks: { orderBy: { order_index: 'asc' } },
      },
    });
    if (!t) throw new NotFoundException(`Project template ${templateId} not found`);
    return t;
  }

  async listTemplates(orgId: string) {
    return this.prisma.projectTemplate.findMany({
      where: { organization_id: orgId, is_active: true },
      include: {
        milestones: { orderBy: { order_index: 'asc' } },
        tasks: { orderBy: { order_index: 'asc' } },
        _count: { select: { milestones: true, tasks: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async getTemplate(orgId: string, templateId: string) {
    return this.findOrFail(orgId, templateId);
  }

  async createTemplate(orgId: string, userId: string, dto: CreateProjectTemplateDto) {
    const template = await this.prisma.projectTemplate.create({
      data: {
        organization_id: orgId,
        created_by_user_id: userId,
        name: dto.name,
        description: dto.description,
      },
    });

    if (dto.milestones?.length) {
      for (let i = 0; i < dto.milestones.length; i++) {
        const ms = dto.milestones[i];
        const milestone = await this.prisma.projectTemplateMilestone.create({
          data: {
            organization_id: orgId,
            project_template_id: template.id,
            name: ms.name,
            description: ms.description,
            order_index: ms.order_index ?? i,
          },
        });

        if (ms.tasks?.length) {
          await this.prisma.projectTemplateTask.createMany({
            data: ms.tasks.map((t, j) => ({
              organization_id: orgId,
              project_template_id: template.id,
              milestone_id: milestone.id,
              title: t.title,
              description: t.description,
              priority_id: t.priority_id,
              estimated_days: t.estimated_days,
              default_assignee_user_id: t.default_assignee_user_id,
              default_assignee_role: t.default_assignee_role,
              order_index: t.order_index ?? j,
              checklist_items: (t.checklist_items ?? []) as never,
            })),
          });
        }
      }
    }

    if (dto.tasks?.length) {
      await this.prisma.projectTemplateTask.createMany({
        data: dto.tasks.map((t, j) => ({
          organization_id: orgId,
          project_template_id: template.id,
          milestone_id: null,
          title: t.title,
          description: t.description,
          priority_id: t.priority_id,
          estimated_days: t.estimated_days,
          default_assignee_user_id: t.default_assignee_user_id,
          default_assignee_role: t.default_assignee_role,
          order_index: t.order_index ?? j,
          checklist_items: (t.checklist_items ?? []) as never,
        })),
      });
    }

    return this.findOrFail(orgId, template.id);
  }

  async updateTemplate(orgId: string, templateId: string, dto: Partial<CreateProjectTemplateDto>) {
    await this.findOrFail(orgId, templateId);
    return this.prisma.projectTemplate.update({
      where: { id: templateId, organization_id: orgId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
      include: {
        milestones: { orderBy: { order_index: 'asc' } },
        tasks: { orderBy: { order_index: 'asc' } },
      },
    });
  }

  async deactivateTemplate(orgId: string, templateId: string) {
    await this.findOrFail(orgId, templateId);
    await this.prisma.projectTemplate.update({
      where: { id: templateId, organization_id: orgId },
      data: { is_active: false },
    });
    return { message: 'Template deactivated' };
  }

  // ─── Milestone management ────────────────────────────────────────────────────

  async addMilestone(orgId: string, templateId: string, dto: { name: string; description?: string; order_index?: number }) {
    await this.findOrFail(orgId, templateId);
    const count = await this.prisma.projectTemplateMilestone.count({ where: { project_template_id: templateId } });
    return this.prisma.projectTemplateMilestone.create({
      data: {
        organization_id: orgId,
        project_template_id: templateId,
        name: dto.name,
        description: dto.description,
        order_index: dto.order_index ?? count,
      },
    });
  }

  async updateMilestone(orgId: string, templateId: string, milestoneId: string, dto: Partial<{ name: string; description: string; order_index: number }>) {
    await this.findOrFail(orgId, templateId);
    const milestone = await this.prisma.projectTemplateMilestone.findFirst({
      where: { id: milestoneId, project_template_id: templateId, organization_id: orgId },
      select: { id: true },
    });
    if (!milestone) throw new NotFoundException(`Template milestone ${milestoneId} not found`);
    return this.prisma.projectTemplateMilestone.update({
      where: { id: milestoneId, project_template_id: templateId, organization_id: orgId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.order_index !== undefined && { order_index: dto.order_index }),
      },
    });
  }

  async deleteMilestone(orgId: string, templateId: string, milestoneId: string) {
    await this.findOrFail(orgId, templateId);
    const milestone = await this.prisma.projectTemplateMilestone.findFirst({
      where: { id: milestoneId, project_template_id: templateId, organization_id: orgId },
      select: { id: true },
    });
    if (!milestone) throw new NotFoundException(`Template milestone ${milestoneId} not found`);
    await this.prisma.projectTemplateMilestone.delete({ where: { id: milestoneId, project_template_id: templateId, organization_id: orgId } });
    return { message: 'Milestone deleted' };
  }

  // ─── Task management ─────────────────────────────────────────────────────────

  async addTask(orgId: string, templateId: string, dto: {
    title: string; description?: string; priority_id?: string; milestone_id?: string;
    estimated_days?: number; default_assignee_user_id?: string; default_assignee_role?: string;
    order_index?: number; checklist_items?: { title: string }[];
  }) {
    await this.findOrFail(orgId, templateId);
    const count = await this.prisma.projectTemplateTask.count({ where: { project_template_id: templateId } });
    return this.prisma.projectTemplateTask.create({
      data: {
        organization_id: orgId,
        project_template_id: templateId,
        milestone_id: dto.milestone_id ?? null,
        title: dto.title,
        description: dto.description,
        priority_id: dto.priority_id,
        estimated_days: dto.estimated_days,
        default_assignee_user_id: dto.default_assignee_user_id,
        default_assignee_role: dto.default_assignee_role,
        order_index: dto.order_index ?? count,
        checklist_items: (dto.checklist_items ?? []) as never,
      },
    });
  }

  async updateTask(orgId: string, templateId: string, taskId: string, dto: Partial<{
    title: string; description: string; priority_id: string; milestone_id: string;
    estimated_days: number; default_assignee_user_id: string; default_assignee_role: string;
    order_index: number;
  }>) {
    await this.findOrFail(orgId, templateId);
    const task = await this.prisma.projectTemplateTask.findFirst({
      where: { id: taskId, project_template_id: templateId, organization_id: orgId },
      select: { id: true },
    });
    if (!task) throw new NotFoundException(`Template task ${taskId} not found`);
    return this.prisma.projectTemplateTask.update({
      where: { id: taskId, project_template_id: templateId, organization_id: orgId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.priority_id !== undefined && { priority_id: dto.priority_id }),
        ...(dto.milestone_id !== undefined && { milestone_id: dto.milestone_id }),
        ...(dto.estimated_days !== undefined && { estimated_days: dto.estimated_days }),
        ...(dto.default_assignee_user_id !== undefined && { default_assignee_user_id: dto.default_assignee_user_id }),
        ...(dto.default_assignee_role !== undefined && { default_assignee_role: dto.default_assignee_role }),
        ...(dto.order_index !== undefined && { order_index: dto.order_index }),
      },
    });
  }

  async deleteTask(orgId: string, templateId: string, taskId: string) {
    await this.findOrFail(orgId, templateId);
    const task = await this.prisma.projectTemplateTask.findFirst({
      where: { id: taskId, project_template_id: templateId, organization_id: orgId },
      select: { id: true },
    });
    if (!task) throw new NotFoundException(`Template task ${taskId} not found`);
    await this.prisma.projectTemplateTask.delete({ where: { id: taskId, project_template_id: templateId, organization_id: orgId } });
    return { message: 'Task deleted' };
  }
}
