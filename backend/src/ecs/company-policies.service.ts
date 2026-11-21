import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePolicyDto } from './dto/create-policy.dto';
import { UpdatePolicyDto } from './dto/update-policy.dto';
import { CreatePolicyItemDto } from './dto/create-policy-item.dto';
import { UpdatePolicyItemDto } from './dto/update-policy-item.dto';
import { AssignPolicyDto } from './dto/assign-policy.dto';

@Injectable()
export class CompanyPoliciesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(orgId: string) {
    return this.prisma.companyPolicy.findMany({
      where: { organization_id: orgId },
      include: { _count: { select: { items: true, assignments: true } } },
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(policyId: string, orgId: string) {
    const policy = await this.prisma.companyPolicy.findFirst({
      where: { id: policyId, organization_id: orgId },
      include: {
        items: { orderBy: { order_index: 'asc' } },
        _count: { select: { assignments: true } },
      },
    });
    if (!policy) throw new NotFoundException('Policy not found');
    return policy;
  }

  async create(orgId: string, userId: string, dto: CreatePolicyDto) {
    return this.prisma.companyPolicy.create({
      data: {
        organization_id: orgId,
        created_by_user_id: userId,
        title: dto.title,
        description: dto.description,
      },
    });
  }

  async update(policyId: string, orgId: string, dto: UpdatePolicyDto) {
    await this.findOne(policyId, orgId);
    return this.prisma.companyPolicy.update({
      where: { id: policyId },
      data: dto,
    });
  }

  async publish(policyId: string, orgId: string) {
    await this.findOne(policyId, orgId);
    return this.prisma.companyPolicy.update({
      where: { id: policyId },
      data: { status: 'published' },
    });
  }

  async archive(policyId: string, orgId: string) {
    await this.findOne(policyId, orgId);
    return this.prisma.companyPolicy.update({
      where: { id: policyId },
      data: { status: 'archived' },
    });
  }

  async delete(policyId: string, orgId: string) {
    await this.findOne(policyId, orgId);
    await this.prisma.companyPolicy.delete({ where: { id: policyId } });
  }

  async addItem(policyId: string, orgId: string, dto: CreatePolicyItemDto) {
    await this.findOne(policyId, orgId);
    const last = await this.prisma.companyPolicyItem.findFirst({
      where: { policy_id: policyId },
      orderBy: { order_index: 'desc' },
    });
    const order_index = dto.order_index ?? (last ? last.order_index + 1 : 0);
    return this.prisma.companyPolicyItem.create({
      data: { ...dto, policy_id: policyId, order_index },
    });
  }

  async updateItem(policyId: string, itemId: string, orgId: string, dto: UpdatePolicyItemDto) {
    await this.findOne(policyId, orgId);
    return this.prisma.companyPolicyItem.update({
      where: { id: itemId },
      data: dto,
    });
  }

  async deleteItem(policyId: string, itemId: string, orgId: string) {
    await this.findOne(policyId, orgId);
    await this.prisma.companyPolicyItem.delete({ where: { id: itemId } });
  }

  async assignPolicy(policyId: string, orgId: string, userId: string, dto: AssignPolicyDto) {
    await this.findOne(policyId, orgId);
    const created: string[] = [];
    for (const empId of dto.employee_profile_ids) {
      const existing = await this.prisma.companyPolicyAssignment.findUnique({
        where: { policy_id_employee_profile_id: { policy_id: policyId, employee_profile_id: empId } },
      });
      if (!existing) {
        await this.prisma.companyPolicyAssignment.create({
          data: { policy_id: policyId, employee_profile_id: empId, assigned_by_user_id: userId },
        });
        created.push(empId);
      }
    }
    return { assigned: created.length, skipped: dto.employee_profile_ids.length - created.length };
  }

  async getAssignments(policyId: string, orgId: string) {
    await this.findOne(policyId, orgId);
    return this.prisma.companyPolicyAssignment.findMany({
      where: { policy_id: policyId },
      include: {
        employee_profile: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            role: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { assigned_at: 'desc' },
    });
  }
}
