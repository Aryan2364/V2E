import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrgScopeGuard } from '../common/guards/org-scope.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { KnowledgeService } from './knowledge.service';
import { CreateKnowledgePostDto } from './dto/create-knowledge-post.dto';
import { CreateKnowledgeCommentDto } from './dto/create-comment.dto';

@ApiTags('knowledge')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, OrgScopeGuard, PermissionsGuard)
@Controller('api/v1/org/:orgId/knowledge')
export class KnowledgeController {
  constructor(private readonly service: KnowledgeService) {}

  @Get()
  @ApiOperation({ summary: 'List knowledge posts' })
  findAll(
    @Param('orgId') orgId: string,
    @Query('scope') scope?: string,
    @Query('tag') tag?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.findAll(orgId, { scope, tag, search, page, pageSize });
  }

  @Get('tags')
  @ApiOperation({ summary: 'Get all tags used in knowledge posts' })
  getTags(@Param('orgId') orgId: string) {
    return this.service.getTags(orgId);
  }

  @Get(':postId')
  @ApiOperation({ summary: 'Get a knowledge post with comments' })
  findOne(@Param('orgId') orgId: string, @Param('postId') postId: string) {
    return this.service.findOne(postId, orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a knowledge post' })
  create(
    @Param('orgId') orgId: string,
    @Request() req: any,
    @Body() dto: CreateKnowledgePostDto,
  ) {
    return this.service.create(orgId, req.user.id, dto);
  }

  @Patch(':postId')
  @ApiOperation({ summary: 'Update a knowledge post' })
  update(
    @Param('orgId') orgId: string,
    @Param('postId') postId: string,
    @Request() req: any,
    @Body() dto: Partial<CreateKnowledgePostDto>,
  ) {
    return this.service.update(postId, orgId, req.user.id, !!req.user.is_admin, dto);
  }

  @Delete(':postId')
  @ApiOperation({ summary: 'Delete a knowledge post' })
  remove(
    @Param('orgId') orgId: string,
    @Param('postId') postId: string,
    @Request() req: any,
  ) {
    return this.service.remove(postId, orgId, req.user.id, !!req.user.is_admin);
  }

  @Post(':postId/pin')
  @RequirePermission('communication.knowledge.manage', PermissionAction.write)
  @ApiOperation({ summary: 'Toggle pin on a knowledge post' })
  togglePin(@Param('orgId') orgId: string, @Param('postId') postId: string) {
    return this.service.togglePin(postId, orgId);
  }

  @Post(':postId/comments')
  @ApiOperation({ summary: 'Add a comment to a knowledge post' })
  addComment(
    @Param('orgId') orgId: string,
    @Param('postId') postId: string,
    @Request() req: any,
    @Body() dto: CreateKnowledgeCommentDto,
  ) {
    return this.service.addComment(postId, orgId, req.user.id, dto);
  }

  @Delete('comments/:commentId')
  @ApiOperation({ summary: 'Delete a knowledge comment' })
  deleteComment(
    @Param('orgId') orgId: string,
    @Param('commentId') commentId: string,
    @Request() req: any,
  ) {
    return this.service.deleteComment(commentId, orgId, req.user.id, !!req.user.is_admin);
  }

  @Post(':postId/react')
  @ApiOperation({ summary: 'Toggle a reaction on a knowledge post' })
  toggleReaction(
    @Param('orgId') orgId: string,
    @Param('postId') postId: string,
    @Request() req: any,
    @Body('emoji') emoji: string,
  ) {
    return this.service.toggleReaction(postId, orgId, req.user.id, emoji);
  }
}
