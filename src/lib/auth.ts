// Admin authentication using PBKDF2-SHA256 via Web Crypto API (Cloudflare Workers compatible)
// Hash format: pbkdf2$<iterations>$<salt_b64>$<hash_b64>

const PBKDF2_ITERATIONS = 100_000;

function b64encode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function b64decode(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function hashPassword(password: string, saltB64?: string): Promise<string> {
  const salt = saltB64 ? b64decode(saltB64) : crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    256,
  );

  return `pbkdf2$${PBKDF2_ITERATIONS}$${btoa(String.fromCharCode(...salt))}$${b64encode(bits)}`;
}

/**
 * Constant-time byte comparison.
 *
 * Prefers `crypto.subtle.timingSafeEqual`, which Cloudflare Workers exposes. It is
 * not part of the DOM `SubtleCrypto` type (hence the cast) and is absent in some
 * runtimes (e.g. Node), so a manually accumulated XOR loop is used as a fallback —
 * that loop is still constant-time with respect to the content of the inputs.
 *
 * The length check must happen before the comparison: timingSafeEqual throws on
 * buffers of unequal length, and length is not treated as a secret.
 */
type TimingSafeSubtle = SubtleCrypto & {
  timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean | Promise<boolean>;
};

async function safeCompare(a: string, b: string): Promise<boolean> {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;

  const timingSafeEqual = (crypto.subtle as TimingSafeSubtle).timingSafeEqual;
  if (typeof timingSafeEqual === "function") {
    return (await timingSafeEqual.call(crypto.subtle, aBytes, bBytes)) === true;
  }

  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    if (typeof stored !== "string" || stored.length === 0) return false;
    const parts = stored.split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
    const iterations = parseInt(parts[1], 10);
    const saltB64 = parts[2];
    const expectedHash = parts[3];

    // Reject malformed stored hashes before deriving anything: a non-numeric
    // iteration count, an empty salt/hash, or a non-base64 salt must not throw
    // out of the PBKDF2 call.
    if (!Number.isFinite(iterations) || iterations < 1 || iterations > 10_000_000) return false;
    if (!saltB64 || !expectedHash) return false;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(saltB64)) return false;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(expectedHash)) return false;

    const salt = b64decode(saltB64);

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );

    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: salt as unknown as BufferSource,
        iterations,
      },
      keyMaterial,
      256,
    );

    const computed = b64encode(bits);
    // Constant-time compare (see safeCompare): a plain `===` on the derived hash
    // leaks prefix-match timing information to an attacker probing the stored hash.
    return await safeCompare(computed, expectedHash);
  } catch {
    return false;
  }
}

export const SESSION_COOKIE = "goldpos_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

export async function createSessionToken(
  adminId: number,
  secret: string,
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${adminId}.${expiresAt}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return { token: `${payload}.${b64encode(sig)}`, expiresAt };
}

export async function verifySessionToken(
  token: string | undefined | null,
  secret: string,
): Promise<{ adminId: number } | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const adminId = parseInt(parts[0], 10);
  const expiresAt = parseInt(parts[1], 10);
  const sig = parts[2];
  if (isNaN(adminId) || isNaN(expiresAt)) return null;
  if (expiresAt < Math.floor(Date.now() / 1000)) return null;

  const payload = `${adminId}.${expiresAt}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = b64encode(sigBuf);

  // Constant-time-ish comparison
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  if (diff !== 0) return null;

  return { adminId };
}

export function parseCookie(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return out;
}
