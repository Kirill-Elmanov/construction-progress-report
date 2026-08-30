import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

/**
 * Healthcheck (ТЗ раздел 4.3 «Служебное», 4.9 ЭТАП 10).
 * GET /health — проверяет, что сервер жив и БД отвечает.
 * Специально ВНЕ версионного префикса /api/v1 (по ТЗ).
 */
export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    // Простой пинг БД: SELECT 1
    await prisma.$queryRaw`SELECT 1`;

    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      db: "connected",
    };
  });
}