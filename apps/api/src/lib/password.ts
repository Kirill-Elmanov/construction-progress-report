import argon2 from "argon2";

/**
 * Хеширование и проверка паролей (ТЗ раздел 4.6 — argon2id).
 * argon2id — гибрид, устойчив к GPU- и side-channel-атакам.
 */

const HASH_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // ~19 МБ
  timeCost: 2,
  parallelism: 1,
};

/** Захешировать пароль перед сохранением в БД */
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, HASH_OPTIONS);
}

/** Проверить пароль против хеша из БД */
export async function verifyPassword(
  hash: string,
  plain: string
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}