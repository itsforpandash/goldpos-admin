// NOTE: this module deliberately has no imports. It is imported by
// src/middleware.ts and by the /api/auth/* endpoints, and keeping it
// dependency-free guarantees it cannot drag in side effects.

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

/** Grep this string in `npx wrangler tail`. */
export const FATAL_MARKER = "FATAL: SESSION_SECRET is not configured";

/**
 * Minimum accepted length for SESSION_SECRET, in characters.
 * HMAC-SHA256 keys carry 256 bits of entropy; anything shorter than 32 chars
 * cannot plausibly hold that, so we refuse it rather than pretend it is safe.
 */
export const MIN_SESSION_SECRET_LENGTH = 32;

/**
 * Values that are documentation scaffolding, not secrets. Substring match,
 * case-insensitive. A real random secret will not contain any of these.
 * "insecure" and "dev-secret" are here to catch re-introductions of the
 * hardcoded dev fallback that used to live in this file; the literal itself is
 * deliberately not written down anywhere in the repo.
 */
const PLACEHOLDER_SUBSTRINGS = [
  "insecure",        // the retired hardcoded dev fallback contained this
  "dev-secret",      // ...as did this
  "example_value",
  "example-value",
  "examplevalue",
  "changeme",
  "change-me",
  "change_in_production",
  "change-in-production",
  "placeholder",
  "your-secret",
  "your_secret",
  "your-value",
  "your_value",
  "replace-me",
  "replace_me",
];

/** Reasons already reported to the console for this isolate, to avoid log floods. */
const reported = new Set<string>();

function reportOnce(reason: string, detail: string): void {
  if (reported.has(reason)) return;
  reported.add(reason);
  console.error(`${FATAL_MARKER} (${reason}): ${detail}`);
}

/**
 * Returns a throwaway, unguessable signing key for the current call ONLY.
 *
 * This is NOT a fallback secret and must never become one. Two properties
 * matter, and both are load-bearing:
 *
 *  1. It is 32 bytes of `crypto.getRandomValues()` output, drawn fresh on every
 *     call. An attacker who reads this repository cannot predict it, so no
 *     token can ever be forged against it.
 *  2. A new value is drawn per call, so the key used to SIGN a session is never
 *     the key used to VERIFY one. A misconfigured deployment therefore
 *     authenticates nobody — not even a freshly completed login — instead of
 *     quietly running on a guessable key.
 *
 * A hardcoded constant here would reintroduce exactly the vulnerability this
 * file exists to remove, because a public constant is a forgeable constant.
 */
function unusableSessionKey(reason: string, detail: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  reportOnce(reason, detail);
  return btoa(String.fromCharCode(...bytes));
}

function describeWeakReason(value: string): string | null {
  if (value.length === 0) return "empty";
  if (value.trim().length === 0) return "whitespace-only";
  if (value.length < MIN_SESSION_SECRET_LENGTH) {
    return `too-short (${value.length} chars, minimum ${MIN_SESSION_SECRET_LENGTH})`;
  }
  const lower = value.toLowerCase();
  for (const needle of PLACEHOLDER_SUBSTRINGS) {
    if (lower.includes(needle)) return `placeholder-value (contains "${needle}")`;
  }
  return null;
}

/**
 * Resolves the key that signs and verifies admin panel session cookies.
 *
 * It reads SESSION_SECRET and nothing else. API_TOKEN is deliberately NOT a
 * fallback: API_TOKEN authenticates the mobile app and therefore ships inside
 * a distributed APK, where it is semi-public by nature. SESSION_SECRET signs
 * super_admin sessions and must never leave the server. Sharing one key would
 * let anyone who unzips the APK mint an admin session, so the two trust
 * domains stay cryptographically independent.
 *
 * Failure mode: a missing or weak SESSION_SECRET is a deployment
 * misconfiguration, not a user error, so it is refused loudly — but it does
 * NOT throw. src/middleware.ts wraps its whole auth block
 * in try/catch and redirects to /admin/login on any throw, so throwing here
 * would turn a missing secret into an invisible infinite login redirect with
 * the real cause buried in a swallowed log. Returning an unusable key instead
 * keeps the failure observable: every rejected request carries the FATAL_MARKER
 * line to `npx wrangler tail`, the admin is denied (fail closed), and
 * /admin/login still renders so an operator can actually see the panel. The
 * fix is `npx wrangler secret put SESSION_SECRET`.
 */
export function getEnvSecret(env: Record<string, string | undefined>): string {
  const raw = env.SESSION_SECRET;

  if (raw === undefined || raw === null) {
    return unusableSessionKey(
      "missing",
      "the SESSION_SECRET binding is absent. Set it with `npx wrangler secret put SESSION_SECRET`. " +
        "All admin sessions are refused until then.",
    );
  }

  // Validated on the trimmed value so that whitespace pasted from a shell or a
  // heredoc cannot pad an otherwise-too-short secret over the limit.
  const secret = raw.trim();
  const reason = describeWeakReason(secret);
  if (reason) {
    return unusableSessionKey(
      `rejected:${reason}`,
      `SESSION_SECRET is present but unusable: ${reason}. Generate a strong value ` +
        "with `openssl rand -hex 32` and set it with `npx wrangler secret put SESSION_SECRET`. " +
        "All admin sessions are refused until then.",
    );
  }

  return secret;
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}