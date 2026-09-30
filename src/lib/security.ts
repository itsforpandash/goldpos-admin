/**
 * Lightweight in-memory rate limiter (per Worker isolate).
 * Sliding-window counter. Suitable for a single-zone deployment.
 */
type WindowRecord = { count: number; windowStart: number };

export class RateLimiter {
  private records = new Map<string, WindowRecord>();
  private readonly windowMs: number;
  private readonly maxHits: number;

  constructor(windowMs: number, maxHits: number) {
    this.windowMs = windowMs;
    this.maxHits = maxHits;
  }

  allow(key: string): boolean {
    const now = Date.now();
    const rec = this.records.get(key);
    if (!rec || now - rec.windowStart > this.windowMs) {
      this.records.set(key, { count: 1, windowStart: now });
      // Opportunistic cleanup
      if (this.records.size > 10_000) {
        for (const [k, r] of this.records) {
          if (now - r.windowStart > this.windowMs) this.records.delete(k);
        }
      }
      return true;
    }
    rec.count++;
    return rec.count <= this.maxHits;
  }
}

// Login: 10 attempts per 5 minutes per IP+username
export const loginLimiter = new RateLimiter(5 * 60 * 1000, 10);
// Mobile license activation: 30 per hour per device/IP
export const mobileActivateLimiter = new RateLimiter(60 * 60 * 1000, 30);
