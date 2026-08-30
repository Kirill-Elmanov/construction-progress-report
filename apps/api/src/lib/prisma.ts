import { PrismaClient } from "@prisma/client";

/**
 * Singleton Prisma-клиента.
 * В dev при hot-reload (tsx watch) не плодим лишние подключения к БД.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}