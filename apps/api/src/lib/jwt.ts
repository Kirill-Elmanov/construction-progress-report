import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";

/**
 * Работа с JWT (ТЗ раздел 4.6).
 * access — короткий (15 мин), в теле ответа.
 * refresh — долгий (30 дней), в httpOnly cookie.
 */

export interface JwtPayload {
  userId: string;
  role: string;
  tenantId: string;
}

/** ACCESS-токен (короткий) */
export function signToken(payload: JwtPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_TTL as SignOptions["expiresIn"],
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

/** REFRESH-токен (долгий) */
export function signRefreshToken(payload: JwtPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_REFRESH_TTL as SignOptions["expiresIn"],
  };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, options);
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
}