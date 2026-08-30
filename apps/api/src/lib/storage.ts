import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Абстракция файлового хранилища [Секция И].
 * Сейчас: локальный диск (apps/api/uploads/).
 * При деплое: меняем ТОЛЬКО тело этих функций на S3/MinIO — роуты не трогаем.
 */

const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads");

/** Генерирует уникальный ключ вида reports/<reportId>/<uuid>.<ext> */
export function makeKey(reportId: string, ext: string): string {
  return `reports/${reportId}/${randomUUID()}.${ext}`;
}

/** Сохраняет буфер по ключу. Создаёт папки при необходимости. */
export async function saveFile(key: string, buffer: Buffer): Promise<void> {
  const abs = path.join(UPLOAD_ROOT, key);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
}

/** Удаляет файл (молча игнорирует, если файла нет). */
export async function deleteFile(key: string): Promise<void> {
  try {
    await fs.unlink(path.join(UPLOAD_ROOT, key));
  } catch {
    /* файла уже нет — ок */
  }
}

/** Абсолютный путь для отдачи через стрим. */
export function getAbsPath(key: string): string {
  return path.join(UPLOAD_ROOT, key);
}