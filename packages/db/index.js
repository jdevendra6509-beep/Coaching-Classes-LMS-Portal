import { PrismaPg } from "@prisma/adapter-pg";
import Prisma from "@prisma/client";

export * from "@prisma/client";

/** Creates a Prisma client over node-postgres for the given connection string. */
export function createPrismaClient(connectionString, options = {}) {
  return new Prisma.PrismaClient({ adapter: new PrismaPg({ connectionString }), ...options });
}
