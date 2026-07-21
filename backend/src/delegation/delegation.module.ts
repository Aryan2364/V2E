import { Module } from '@nestjs/common';
import { DelegationController } from './delegation.controller';
import { DelegationService } from './delegation.service';

// PrismaModule and AccessRightsModule are global. No extra imports needed — the
// review task is created directly (a system task), not through TasksService, so the
// module stays lightweight and free of a circular dependency on TasksModule.
@Module({
  controllers: [DelegationController],
  providers: [DelegationService],
  exports: [DelegationService],
})
export class DelegationModule {}
