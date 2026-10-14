import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsObject, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgScopeGuard } from '../common/guards/org-scope.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { NOTIF_EVENTS } from './notification-events';

interface AuthUser {
  id: string;
  role: string | null;
  is_admin?: boolean;
  organizationId: string;
  isSuperAdmin?: boolean;
}

class UpdateMasterDto {
  @IsObject()
  @IsOptional()
  event_toggles?: Record<string, boolean>;

  @IsInt()
  @IsOptional()
  overdue_followup_days?: number;
}

class SubscribePushDto {
  @IsString()
  endpoint: string;

  @IsObject()
  keys: { p256dh: string; auth: string };

  @IsString()
  @IsOptional()
  userAgent?: string;
}

class UnsubscribePushDto {
  @IsString()
  endpoint: string;
}

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgScopeGuard)
@Controller('api/v1/org/:orgId/notifications')
export class NotificationsController {
  constructor(
    private readonly service: NotificationsService,
    private readonly push: PushService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List my notifications (cursor paginated) + unread count' })
  list(
    @Param('orgId') orgId: string,
    @CurrentUser() user: AuthUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(orgId, user.id, cursor, limit ? parseInt(limit, 10) : 20);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread notification count' })
  unreadCount(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser) {
    return this.service.unreadCount(orgId, user.id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all my notifications read' })
  markAllRead(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser) {
    return this.service.markAllRead(orgId, user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification read' })
  markRead(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.markRead(orgId, user.id, id);
  }

  @Patch(':id/unread')
  @ApiOperation({ summary: 'Mark one notification unread (phone swipe/dot toggle)' })
  markUnread(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    // Recipient-scoped by construction (WHERE user_id = req.user.id), same as
    // markRead — no ScopeService.assertCanActOn needed, per AUTHORIZATION.md.
    return this.service.markUnread(orgId, user.id, id);
  }

  // ─── Master config ───────────────────────────────────────────────────────────

  @Get('master')
  @ApiOperation({ summary: 'Get notification master config (incl. event catalog)' })
  async getMaster(@Param('orgId') orgId: string) {
    const master = await this.service.getMaster(orgId);
    return { ...master, catalog: NOTIF_EVENTS };
  }

  @Put('master')
  @ApiOperation({ summary: 'Update notification master config (org admin only)' })
  updateMaster(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateMasterDto) {
    if (!user.is_admin && !user.isSuperAdmin) {
      throw new ForbiddenException('Only org admins can update notification settings');
    }
    return this.service.updateMaster(orgId, dto);
  }

  // ─── Web push ────────────────────────────────────────────────────────────────

  @Get('push/vapid-public-key')
  @ApiOperation({ summary: 'VAPID public key for push subscription (null if push disabled)' })
  vapidKey() {
    return { key: this.push.getPublicKey() };
  }

  @Post('push/subscribe')
  @ApiOperation({ summary: 'Register a web push subscription for this user' })
  subscribe(@Param('orgId') orgId: string, @CurrentUser() user: AuthUser, @Body() dto: SubscribePushDto) {
    return this.service.subscribePush(orgId, user.id, dto);
  }

  @Delete('push/subscribe')
  @ApiOperation({ summary: 'Remove a web push subscription' })
  unsubscribe(@CurrentUser() user: AuthUser, @Body() dto: UnsubscribePushDto) {
    return this.service.unsubscribePush(user.id, dto.endpoint);
  }
}
