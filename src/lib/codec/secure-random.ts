/**
 * Secure random string generation for GoldPos.
 *
 * Security notes
 * --------------
 * `Math.random()` is NOT cryptographically secure. It is a fast PRNG (xorshift128+
 * in V8) seeded from a non-secret source; its internal state is recoverable from a
 * modest number of outputs, so an attacker who observes a few generated license
 * codes or device hashes can predict every subsequent one. License keys and device
 * hashes are security tokens here (they gate activation), so they must come from
 * `crypto.getRandomValues()` (CSPRNG, e.g. ChaCha20 in V8 / AES in workerd).
 *
 * Modulo bias
 * -----------
 * The obvious `alphabet[floor(rnd * alphabet.length)]` or `byte % alphabet.length`
 * over uniform bytes is BIASED whenever the alphabet size does not divide 256: the
 * low `256 % n` byte values map to the first `256 % n` symbols one extra time.
 * For n = 32 (Crockford) 32 divides 256, so masking is exact. For the device-hash
 * alphabet (n = 55) it does not, and naive modulo over-favors symbols 0..35.
 * `randomString()` therefore uses rejection sampling: bytes >= limit are discarded
 * and redrawn, and `limit` is a whole multiple of the alphabet size, so every
 * accepted byte maps to every symbol exactly `floor(256/n)` times.
 */

/**
 * Crockford Base32 (https://www.crockford.com/base32.html): the 32 symbols
 * 0-9 plus A-Z minus I, L, O, U.
 *
 * WHY I, L, O, U ARE EXCLUDED — all four are dropped because each is
 * visually ambiguous with another symbol that a human may have to transcribe:
 *
 *   I <-> 1   (identical in most sans-serif fonts; I is also easily lost in OCR)
 *   O <-> 0   (identical shape; the classic "is that a zero or an O")
 *   L <-> 1   (in many fonts L is the same glyph as 1, e.g. Verdana/Tahoma)
 *   U <-> V   (U and V differ only in a single curved stroke, and U/V are
 *              commonly read as the same letter in speech and handwriting)
 *
 * Excluding them leaves a 32-symbol alphabet (a power of two, so bit masking is
 * exact), and means the code a support agent reads back over the phone cannot be
 * silently misread. This matters MORE here than in a typical Latin-only product:
 * GoldPos codes are shown in RTL Persian UI and re-typed from screenshots and
 * printed invoices. In RTL context the letter/digit confusions above are harder
 * to spot (the eye reads glyph shapes right-to-left), Persian UI fonts render I/l/1
 * and O/0 very similarly at small sizes, and Persian-Indic digits (۰۱۲...) plus
 * OCR of scanned invoices add two more layers of ambiguity. Crockford decoding
 * treats I/L as 1 and O as 0 as a fallback, so even a mistyped code is recoverable.
 *
 * NOTE: the 4-character group separators ("-") are display-only formatting and
 * carry no entropy. Entropy is counted from payload characters only.
 */
export const CROCKFORD_BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Device-hash alphabet: 55 symbols = Crockford uppercase (I/L/O/U already
 * dropped) + the same lowercase set + digits 2-9. Modelled on the previous
 * device-hash alphabet so existing 32-char rows stay recognizable.
 *
 * 55 does NOT divide 256, so naive `% 55` would bias the first 36 symbols
 * (256 = 4*55 + 36, so symbols 0..35 get a 5/256 chance instead of 4/220).
 * Rejection sampling is therefore mandatory here, unlike for the 32-symbol
 * Crockford license alphabet where masking happens to be exact.
 */
export const DEVICE_HASH_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

/** Output length of generateDeviceHash(); devices.device_hash is VARCHAR(64). */
export const DEVICE_HASH_LENGTH = 32;

/** License code payload: 4 groups of 4 chars = 16 chars x 5 bits = exactly 80 bits. */
export const LICENSE_CODE_GROUP_LENGTH = 4;
export const LICENSE_CODE_GROUP_COUNT = 4;
export const LICENSE_CODE_PAYLOAD_LENGTH = LICENSE_CODE_GROUP_LENGTH * LICENSE_CODE_GROUP_COUNT;

/** Largest byte value that may be accepted, per alphabet size (multiple of n). */
function acceptanceLimit(alphabetSize: number): number {
  return Math.floor(256 / alphabetSize) * alphabetSize;
}

/**
 * Web Crypto caps a single `crypto.getRandomValues` call at 65,536 bytes;
 * anything larger throws QuotaExceededError. Never allocate a bigger buffer.
 */
export const MAX_RANDOM_BYTES = 65_536;

/**
 * Draw one uniformly-random character from `alphabet`, with no modulo bias.
 *
 * Rejection sampling: bytes in [0, limit) are accepted and mapped via `% n`,
 * bytes in [limit, 256) are rejected and redrawn. Because `limit` is an exact
 * multiple of `n`, every symbol is produced by exactly `floor(256/n)` of the
 * accepted bytes.
 */
export function randomChar(alphabet: string): string {
  const n = alphabet.length;
  if (n === 0) throw new Error("randomChar: alphabet must not be empty");
  const limit = acceptanceLimit(n);
  const buf = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const b = buf[0];
    if (b < limit) return alphabet.charAt(b % n);
  }
}

/**
 * Draw a `length`-character string from `alphabet` using crypto.getRandomValues
 * with rejection sampling, so the distribution over symbols is exactly uniform.
 *
 * Bytes are drawn in batches (one CSPRNG call per batch rather than per
 * character) purely for speed; this does not change the distribution. If a batch
 * is unlucky and yields too few accepted bytes, the batch doubles and redraws —
 * with a 55-symbol alphabet the accept rate is 220/256 = 85.9%, so this loop is
 * astronomically unlikely to run a second time.
 *
 * IMPORTANT: each `crypto.getRandomValues` call is capped at 65,536 bytes by the
 * Web Crypto spec (larger requests throw QuotaExceededError). Batches are
 * therefore chunked at MAX_RANDOM_BYTES per call, so arbitrarily long strings
 * work and the call count stays ~1 per 64KiB rather than one per character.
 */
export function randomString(alphabet: string, length: number): string {
  const n = alphabet.length;
  if (n === 0) throw new Error("randomString: alphabet must not be empty");
  if (length <= 0) return "";
  const limit = acceptanceLimit(n);

  const parts: string[] = [];
  let produced = 0;
  let batchBytes = Math.max(16, Math.min(length * 2, MAX_RANDOM_BYTES));
  while (produced < length) {
    const buf = new Uint8Array(batchBytes);
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && produced < length; i++) {
      const b = buf[i];
      if (b < limit) {
        parts.push(alphabet.charAt(b % n));
        produced++;
      }
    }
    if (produced < length) batchBytes = Math.min(batchBytes * 2, MAX_RANDOM_BYTES);
  }
  return parts.join("");
}

/**
 * Group a payload string into hyphen-separated groups for display, e.g.
 * "V9KQX7ZB" + groups of 4 -> "V9KX-X7ZB".
 */
export function groupCode(payload: string, groupLength: number = LICENSE_CODE_GROUP_LENGTH): string {
  const parts: string[] = [];
  for (let i = 0; i < payload.length; i += groupLength) {
    parts.push(payload.slice(i, i + groupLength));
  }
  return parts.join("-");
}