import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCultureStandardDto, BehaviorType } from './dto/create-culture-standard.dto';
import { UpdateCultureStandardDto } from './dto/update-culture-standard.dto';

@Injectable()
export class CultureService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(orgId: string) {
    return this.prisma.cultureStandard.findMany({
      where: { organization_id: orgId },
      orderBy: { created_at: 'asc' },
    });
  }

  async findOne(id: string, orgId: string) {
    const standard = await this.prisma.cultureStandard.findFirst({
      where: { id, organization_id: orgId },
    });

    if (!standard) {
      throw new NotFoundException('Culture standard not found');
    }

    return standard;
  }

  async create(orgId: string, dto: CreateCultureStandardDto) {
    return this.prisma.cultureStandard.create({
      data: {
        organization_id: orgId,
        title: dto.title,
        description: dto.description,
        type: dto.type,
      },
    });
  }

  async update(id: string, orgId: string, dto: UpdateCultureStandardDto) {
    await this.findOne(id, orgId);

    return this.prisma.cultureStandard.update({
      where: { id },
      data: { ...dto },
    });
  }

  async remove(id: string, orgId: string) {
    await this.findOne(id, orgId);

    return this.prisma.cultureStandard.delete({
      where: { id },
    });
  }
}
