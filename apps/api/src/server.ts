import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie"; // 🆕 для refresh-токена (ТЗ 4.6)
import { env, isProd } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { healthRoutes } from "./routes/health.js";
import { bootstrapRoutes } from "./routes/bootstrap.js";
import { authRoutes } from "./routes/auth.js";
import { projectRoutes } from "./routes/projects.js";
import { reportRoutes } from "./routes/reports.js"; 
import { sectionRoutes } from "./routes/sections.js"; 
import { progressRoutes } from "./routes/progress.js"; 
import { issueRoutes } from "./routes/issues.js"; 
import { prescriptionRoutes } from "./routes/prescriptions.js";
import { budgetRoutes } from "./routes/budget.js";
import { resourcesRoutes } from "./routes/resources.js"; // 🆕
import { worklogRoutes } from "./routes/worklog.js"; // 🆕
import multipart from "@fastify/multipart";
import { photoRoutes } from "./routes/photos.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { scheduleRoutes } from "./routes/schedule.js";
import { rdDevelopmentRoutes } from "./routes/rd-development.js";
import { accessLinkRoutes } from "./routes/access-links.js";
import { sectionWorkspaceRoutes } from "./routes/section-workspaces.js";
import { userRoutes } from "./routes/users.js";

async function buildServer() {
  const app = Fastify({
    logger: {
      level: isProd ? "info" : "debug",
      transport: isProd
        ? undefined
        : {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss" },
          },
    },
  });

  await app.register(cors, {
    origin: env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()),
    credentials: true,
  });

  // 🆕 Cookie для refresh-токена (httpOnly, ТЗ 4.6)
  await app.register(cookie, {
    secret: env.JWT_REFRESH_SECRET,
  });

  // Служебные роуты — БЕЗ версионного префикса (ТЗ 4.9)
  await app.register(healthRoutes);

  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  // Все API-роуты под общим префиксом /api/v1 (ТЗ 4.3)
  await app.register(
    async (api) => {
      // Bootstrap суперадмина (одноразовая активация)
      await api.register(bootstrapRoutes);

      // Авторизация
      await api.register(authRoutes);

      // Проекты
      await api.register(projectRoutes);

      await api.register(reportRoutes); 

      await api.register(sectionRoutes); 

      await api.register(progressRoutes); 

      await api.register(issueRoutes);     // 🆕 ДОБАВЬ Секцию Г

      await api.register(prescriptionRoutes); // 🆕 Секция Д

      await api.register(budgetRoutes); // 🆕 Секция Е

      await api.register(resourcesRoutes); // 🆕 Секция Ж

      await api.register(worklogRoutes); // 🆕 Секция З

      await api.register(photoRoutes); // 📷 Секция И

      await api.register(dashboardRoutes); // Дашборд (агрегация всех секций)

      await api.register(scheduleRoutes); // ПР-4.3: График работ

      await api.register(rdDevelopmentRoutes); // ПР-6.4: Разработка РД

      await api.register(accessLinkRoutes); // ПР-1.5: ссылки-доступы + аудит

      await api.register(sectionWorkspaceRoutes); // Этап 3: локальные черновики и версии

      await api.register(userRoutes); // Приглашение и активация руководителей

      // 👇 сюда добавляем все БУДУЩИЕ роуты (sections, reports, links...)
    },
    { prefix: "/api/v1" }
  );

  return app;
}

async function start() {
  const app = await buildServer();

  const shutdown = async (signal: string) => {
    app.log.info(`Получен ${signal}, останавливаемся...`);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`🚀 API запущен на http://localhost:${env.PORT}`);
    app.log.info(`Healthcheck: http://localhost:${env.PORT}/health`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
