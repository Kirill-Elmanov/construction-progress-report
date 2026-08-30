import type { FastifyReply } from "fastify";

/**
 * Единый формат ошибок по ТЗ 4.3: { error: { code, message } }
 */
export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown
) {
  return reply.code(statusCode).send({
    error: { code, message, ...(details ? { details } : {}) },
  });
}

// Частые ошибки — короткие хелперы
export const Errors = {
  unauthorized: (reply: FastifyReply, message = "Требуется авторизация") =>
    sendError(reply, 401, "UNAUTHORIZED", message),

  forbidden: (reply: FastifyReply, message = "Недостаточно прав") =>
    sendError(reply, 403, "FORBIDDEN", message),

  notFound: (reply: FastifyReply, message = "Не найдено") =>
    sendError(reply, 404, "NOT_FOUND", message),

  validation: (reply: FastifyReply, details: unknown) =>
    sendError(reply, 400, "VALIDATION_ERROR", "Ошибка валидации", details),

    conflict(reply: FastifyReply, message: string) {
    return reply.code(409).send({ error: { code: "CONFLICT", message } });
  },
};