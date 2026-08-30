import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL обязателен"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET минимум 16 символов"),
  JWT_REFRESH_SECRET: z.string().min(16, "JWT_REFRESH_SECRET минимум 16 символов"),
  JWT_ACCESS_TTL: z.string().default("2h"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  // Правки v5: опубликованный CSV листа со справочником сотрудников.
  GOOGLE_PARTICIPANTS_CSV_URL: z.string().url().optional().or(z.literal("")),

  // 🔑 Токен для одноразовой активации суперадмина (ТЗ 4.9 ЭТАП 1)
  BOOTSTRAP_TOKEN: z.string().min(8, "BOOTSTRAP_TOKEN минимум 8 символов"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Ошибка в переменных окружения:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
