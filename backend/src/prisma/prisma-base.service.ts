import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createPgAdapter } from './pg-connection';

/**
 * The raw, un-extended Prisma client. Owns the connection lifecycle.
 *
 * Application services do NOT inject this directly — they inject `PrismaService`,
 * which is the same connection wrapped with the audit `$extends` capture hook.
 * This base client is used where extension recursion must be avoided: the
 * extension's own prior-row reads, the audit writer, and label enrichment.
 */
@Injectable()
export class PrismaBaseService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: createPgAdapter() });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
