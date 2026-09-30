import { parseCookie } from "@/lib/auth";
import { AdminUserService } from "@/lib/services/admin";

export type SessionAdmin = {
  id: number;
  username: string;
  full_name: string;
  role: string;
  is_active: number | boolean;
};

/** Roles hierarchy: super_admin > admin > support > operator */
const ROLE_RANK: Record<string, number> = {
  super_admin: 4,
  admin: 3,
  support: 2,
  operator: 1,
};

export function hasMinRole(admin: SessionAdmin | null, minRole: string): boolean {
  if (!admin) return false;
  return (ROLE_RANK[admin.role] ?? 0) >= (ROLE_RANK[minRole] ?? 0);
}

export function getEnvSecret(env: Record<string, string | undefined>): string {
  if (env.SESSION_SECRET && env.SESSION_SECRET !== "") return env.SESSION_SECRET;
  if (env.API_TOKEN && env.API_TOKEN !== "") return env.API_TOKEN;
  return "goldpos-insecure-dev-secret";
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}
