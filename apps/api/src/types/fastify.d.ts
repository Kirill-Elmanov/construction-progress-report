import "fastify";
import type { RoleType } from "@prisma/client";

// Кого мы кладём в request после проверки JWT
export interface AuthUser {
  userId: string;
  role: RoleType;
  tenantId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
    /** Этап 2: актор запроса — пользователь или сотрудник по персональной ссылке. */
    actor?: {
      kind: "user" | "link";
      id: string;
      name: string;
      email: string | null;
      role: string;
      tenantId: string;
      grants?: {
        projectId: string;
        projectName: string;
        allowedSections: string[];
      }[];
    };
  }
}
