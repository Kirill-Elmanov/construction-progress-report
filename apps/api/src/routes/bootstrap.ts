import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../lib/password.js";
import { env } from "../config/env.js";

/**
 * Bootstrap суперадмина (ТЗ раздел 4.9 ЭТАП 1, шаг 1.3).
 * Одноразовая активация: задаём пароль суперадмину через секретный токен.
 *
 * Логика безопасности:
 *  - токен из URL сверяется с BOOTSTRAP_TOKEN из .env
 *  - работает ТОЛЬКО пока у суперадмина пустой пароль (passwordHash == null)
 *  - после установки пароля повторный вызов запрещён (409)
 */

const bodySchema = z.object({
  password: z.string().min(8, "Пароль минимум 8 символов"),
});

export async function bootstrapRoutes(app: FastifyInstance) {
  app.post("/bootstrap/:token", async (request, reply) => {
    const { token } = request.params as { token: string };

    // 1. Проверяем токен
    if (token !== env.BOOTSTRAP_TOKEN) {
      return reply.code(403).send({ error: "Неверный bootstrap-токен" });
    }

    // 2. Валидируем тело запроса
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Ошибка валидации",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    // 3. Ищем суперадмина (роль SUPERADMIN)
const superadmin = await prisma.user.findFirst({
  where: { role: "superadmin" },
});
    if (!superadmin) {
      return reply.code(404).send({ error: "Суперадмин не найден в БД" });
    }

    // 4. Разрешаем только если пароль ещё не задан
    if (superadmin.passwordHash) {
      return reply
        .code(409)
        .send({ error: "Суперадмин уже активирован. Bootstrap недоступен." });
    }

    // 5. Хешируем и сохраняем пароль
    const passwordHash = await hashPassword(parsed.data.password);
    await prisma.user.update({
      where: { id: superadmin.id },
      data: { passwordHash },
    });

    request.log.info(`✅ Суперадмин ${superadmin.email} активирован`);

    return {
      status: "ok",
      message: "Суперадмин активирован. Теперь можно войти.",
      email: superadmin.email,
    };
  });
}