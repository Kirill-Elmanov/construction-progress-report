import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import {
  signToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../lib/jwt.js";
import { authGuard } from "../middleware/authGuard.js";
import { Errors, sendError } from "../lib/errors.js";
import { env, isProd } from "../config/env.js";
import { getEmployeeName } from "../lib/employees.js";

/**
 * Авторизация (ТЗ раздел 4.3, 4.6).
 * POST /auth/login            — email+пароль → access (в теле) + refresh (в cookie).
 * POST /auth/refresh          — refresh из cookie → новый access.
 * POST /auth/logout           — чистим refresh cookie.
 * GET  /auth/me               — данные текущего пользователя.
 * POST /auth/change-password  — смена своего пароля.
 */

// Имя cookie для refresh-токена
const REFRESH_COOKIE = "refresh_token";

// Опции httpOnly cookie (ТЗ 4.6: безопасность)
function refreshCookieOptions() {
  return {
    httpOnly: true, // JS на фронте не читает — защита от XSS
    secure: isProd, // только HTTPS в проде
    sameSite: "lax" as const, // защита от CSRF
    path: "/", // доступна везде
    // maxAge берётся из refresh TTL (30 дней в секундах)
    maxAge: 30 * 24 * 60 * 60,
  };
}

// Кладём refresh в cookie
function setRefreshCookie(reply: FastifyReply, token: string) {
  reply.setCookie(REFRESH_COOKIE, token, refreshCookieOptions());
}

// Чистим refresh cookie
function clearRefreshCookie(reply: FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE, { path: "/" });
}

// Схема входа
const loginSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(1, "Пароль обязателен"),
});

// Схема смены пароля (ТЗ 4.6: минимум 10 символов)
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Введите текущий пароль"),
  newPassword: z
    .string()
    .min(10, "Пароль должен быть не короче 10 символов")
    .regex(/[a-zA-Zа-яА-Я]/, "Пароль должен содержать хотя бы одну букву")
    .regex(/[0-9]/, "Пароль должен содержать хотя бы одну цифру"),
});

export async function authRoutes(app: FastifyInstance) {
  // ===================================================================
  // POST /auth/login — вход: access в теле + refresh в httpOnly cookie
  // ===================================================================
  app.post("/auth/login", async (request, reply) => {
    // 1. Валидируем тело
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return Errors.validation(reply, parsed.error.flatten().fieldErrors);
    }

    const { password } = parsed.data;
    const email = parsed.data.email.trim().toLowerCase();

    // 2. Ищем пользователя по email
    const user = await prisma.user.findUnique({ where: { email } });

    // Единое сообщение об ошибке (не палим, что именно не так — безопасность)
    if (!user || !user.passwordHash) {
      return Errors.unauthorized(reply, "Неверный email или пароль");
    }

    // 3. Проверяем, активен ли аккаунт
    if (!user.isActive) {
      return Errors.forbidden(reply, "Аккаунт деактивирован");
    }

    // 4. Сверяем пароль (порядок: hash, plain!)
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      return Errors.unauthorized(reply, "Неверный email или пароль");
    }

    // 5. Готовим payload
    const payload = {
      userId: user.id,
      role: user.role,
      tenantId: user.tenantId,
    };

    // 6. Выдаём access (в тело) + refresh (в cookie)
    const token = signToken(payload);
    const refreshToken = signRefreshToken(payload);
    setRefreshCookie(reply, refreshToken);

    request.log.info(`✅ Вход: ${user.email} (${user.role})`);

    const fullName = (await getEmployeeName(user.email)) ?? user.displayName;

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        fullName,               // 🆕 ПР-1.3
        mustChangePassword: user.mustChangePassword,
      },
    };
  });

  // ===================================================================
  // POST /auth/refresh — обновить access по refresh-токену из cookie
  // ===================================================================
  app.post("/auth/refresh", async (request, reply) => {
    // 1. Достаём refresh из cookie
    const refreshToken = request.cookies[REFRESH_COOKIE];
    if (!refreshToken) {
      return Errors.unauthorized(reply, "Refresh-токен отсутствует");
    }

    // 2. Проверяем подпись refresh-токена
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      clearRefreshCookie(reply); // токен битый/протух — чистим
      return Errors.unauthorized(reply, "Refresh-токен недействителен");
    }

    // 3. Проверяем, что пользователь ещё существует и активен
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });
    if (!user || !user.isActive) {
      clearRefreshCookie(reply);
      return Errors.unauthorized(reply, "Пользователь не найден или деактивирован");
    }

    // 4. Выдаём новую пару (ротация refresh — безопаснее)
    const newPayload = {
      userId: user.id,
      role: user.role,
      tenantId: user.tenantId,
    };
    const token = signToken(newPayload);
    const newRefresh = signRefreshToken(newPayload);
    setRefreshCookie(reply, newRefresh);

    request.log.info(`🔄 Refresh: ${user.email}`);

    return { token };
  });

  // ===================================================================
  // POST /auth/logout — выход: чистим refresh cookie
  // ===================================================================
  app.post("/auth/logout", async (_request, reply) => {
    clearRefreshCookie(reply);
    return { success: true };
  });

  // ===================================================================
  // GET /auth/me — кто я (ТЗ 4.3). Защищён authGuard.
  // ===================================================================
  app.get("/auth/me", { preHandler: authGuard }, async (request, reply) => {
    // request.user гарантированно есть (authGuard пропустил)
    const user = await prisma.user.findUnique({
      where: { id: request.user!.userId },
      select: {
        id: true,
        email: true,
        role: true,
        accessScope: true,
        displayName: true,
        tenantId: true,
        mustChangePassword: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      return Errors.unauthorized(reply, "Пользователь не найден или деактивирован");
    }

    // Для scope=project — подтянем назначенные проекты
    let projectIds: string[] = [];
    if (user.accessScope === "project") {
      const links = await prisma.userProject.findMany({
        where: { userId: user.id },
        select: { projectId: true },
      });
      projectIds = links.map((l) => l.projectId);
    }

    // ПР-1.3: ФИО берём из Google-справочника, fallback — displayName из БД
    const fullName = (await getEmployeeName(user.email)) ?? user.displayName;

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      accessScope: user.accessScope,
      displayName: user.displayName,
      fullName,                 // 🆕 ФИО для шапки интерфейса
      tenantId: user.tenantId,
      mustChangePassword: user.mustChangePassword,
      projectIds, // пусто для global (доступ ко всему tenant)
    };
  });

  // ===================================================================
  // POST /auth/change-password — смена своего пароля (ТЗ 4.3, 4.6).
  // Защищён authGuard. Сбрасывает mustChangePassword = false.
  // ===================================================================
  app.post(
    "/auth/change-password",
    { preHandler: authGuard },
    async (request, reply) => {
      // 1. Валидация тела
      const parsed = changePasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        return Errors.validation(reply, parsed.error.flatten().fieldErrors);
      }
      const { currentPassword, newPassword } = parsed.data;

      // 2. Достаём пользователя из БД
      const user = await prisma.user.findUnique({
        where: { id: request.user!.userId },
      });
      if (!user || !user.isActive) {
        return Errors.unauthorized(reply, "Пользователь не найден или деактивирован");
      }

      // 3. Проверяем текущий пароль (порядок: hash, plain!)
      const ok = await verifyPassword(user.passwordHash, currentPassword);
      if (!ok) {
        return Errors.unauthorized(reply, "Текущий пароль неверный");
      }

      // 4. Новый пароль не должен совпадать с текущим
      const samePassword = await verifyPassword(user.passwordHash, newPassword);
      if (samePassword) {
        return sendError(
          reply,
          400,
          "SAME_PASSWORD",
          "Новый пароль должен отличаться от текущего"
        );
      }

      // 5. Хешируем и сохраняем + сбрасываем флаг
      const newHash = await hashPassword(newPassword);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          mustChangePassword: false,
        },
      });

      request.log.info(`🔑 Пароль изменён: ${user.email}`);

      // 🆕 Безопасность: после смены пароля — logout (чистим refresh)
      clearRefreshCookie(reply);

      return { success: true };
    }
  );
}
