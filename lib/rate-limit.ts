/**
 * Simple in-memory rate limiter.
 *
 * Each unique key (typically an IP address) is allowed up to `maxRequests`
 * within a rolling `windowMs` window.  Old entries are lazily evicted on
 * the next check, so no periodic cleanup timer is needed — sufficient for
 * a low-traffic artist portfolio.
 */

type Entry = {
  count: number;
  resetAt: number;
};

const store = new Map<string, Entry>();

export type RateLimitOptions = {
  /** Time window in milliseconds (default 60 000 = 1 min) */
  windowMs?: number;
  /** Max requests allowed per window (default 5) */
  maxRequests?: number;
};

/**
 * Returns `true` when the request should be allowed, `false` when the
 * caller has exceeded their quota.
 */
export function checkRateLimit(
  key: string,
  options: RateLimitOptions = {},
): boolean {
  const windowMs = options.windowMs ?? 60_000;
  const maxRequests = options.maxRequests ?? 5;
  const now = Date.now();

  const entry = store.get(key);

  /* Window expired or first visit → start fresh */
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  /* Within window but over limit */
  if (entry.count >= maxRequests) {
    return false;
  }

  entry.count += 1;
  return true;
}

/**
 * Extract the best-guess client IP from a standard `Request` object.
 * Works behind most reverse proxies (Vercel, Cloudflare, nginx, etc.).
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;

  return "unknown";
}
