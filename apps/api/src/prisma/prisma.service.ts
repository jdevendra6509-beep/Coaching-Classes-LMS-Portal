import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, type Prisma, type PrismaClient } from "@lms/db";
import { env } from "../config/env.js";

export type Tx = Prisma.TransactionClient;

/**
 * Two connection pools:
 *  - `tenant(instituteId, fn)` runs fn in a transaction as the RLS-restricted `lms_app` role
 *    with `app.institute_id` set transaction-locally. All institute features use this.
 *  - `platform` connects as `lms_platform`, which a policy lets see every institute. Only auth,
 *    platform-admin and webhook code may use it, and it must always filter by institute explicitly.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly app: PrismaClient = createPrismaClient(env().DATABASE_URL);
  readonly platform: PrismaClient = createPrismaClient(env().DATABASE_URL_PLATFORM);

  tenant<T>(instituteId: string, fn: (tx: Tx) => Promise<T>, options?: { timeout?: number }): Promise<T> {
    return this.app.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.institute_id', ${instituteId}, true)`;
        return fn(tx);
      },
      { timeout: options?.timeout ?? 10_000 },
    );
  }

  async onModuleDestroy() {
    await Promise.all([this.app.$disconnect(), this.platform.$disconnect()]);
  }
}
