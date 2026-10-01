export interface MobileTokenPayload {
  license_id: number;
  license_code: string;
  device_hash: string;
  user_id: number;
  expires_at: number; // unix timestamp in seconds
  issued_at: number;
}

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

export async function createMobileAccessToken(
  payload: MobileTokenPayload,
  secret: string = "goldpos-mobile-secret-key-2026",
): Promise<string> {
  const payloadStr = btoa(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadStr));
  return `${payloadStr}.${b64encode(sig)}`;
}

export async function verifyMobileAccessToken(
  token: string | undefined | null,
  secret: string = "goldpos-mobile-secret-key-2026",
): Promise<MobileTokenPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  try {
    const payloadStr = parts[0];
    const signature = parts[1];

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadStr));
    const expected = b64encode(sigBuf);

    if (expected !== signature) return null;

    const payload: MobileTokenPayload = JSON.parse(atob(payloadStr));
    return payload;
  } catch {
    return null;
  }
}
