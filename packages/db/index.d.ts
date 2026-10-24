import { PrismaClient, Prisma } from "@prisma/client";

export * from "@prisma/client";

export function createPrismaClient(
  connectionString: string,
  options?: Omit<Prisma.PrismaClientOptions, "adapter">,
): PrismaClient;
