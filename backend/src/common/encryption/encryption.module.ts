import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';

// Global so any module (gcal today, others later) can inject EncryptionService
// without re-importing. ConfigModule is already global (app.module).
@Global()
@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class EncryptionModule {}
