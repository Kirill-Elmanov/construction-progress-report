import { createHash, randomBytes } from "node:crypto";

export const ACTIVATION_TTL_HOURS = 72;

export function createActivationToken() {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashActivationToken(token) };
}

export function hashActivationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function activationExpiresAt(now = new Date()) {
  return new Date(now.getTime() + ACTIVATION_TTL_HOURS * 60 * 60 * 1000);
}
