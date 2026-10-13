import { headers } from "next/headers";

/**
 * Lightweight in-memory sliding-window rate limiter (spec §10.1/§10.3).
 *
 * Suitable as a first line of defense on serverless: each instance keeps
 * its own counters, so limits are per-instance rather than global. For
 * strict global limits, swap the store for Redis/Upstash later — the
 * call sites won't change.
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 20_000;

function prune(now: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [k, b] of buckets) {
    while (b.hits.length && b.hits[0] <= now - 3_600_000) b.hits.shift();
    if (!b.hits.length) buckets.delete(k);
    if (buckets.size < MAX_BUCKETS * 0.9) break;
  }
}

/** Returns true when the caller is within budget; false when limited. */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  prune(now);
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }
  const cutoff = now - windowMs;
  while (bucket.hits.length && bucket.hits[0] <= cutoff) bucket.hits.shift();
  if (bucket.hits.length >= limit) return false;
  bucket.hits.push(now);
  return true;
}

export async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    return (
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      h.get("x-real-ip") ??
      "unknown"
    );
  } catch {
    return "unknown";
  }
}

/** Throws a friendly error when the caller exceeds the budget. */
export async function enforceRateLimit(
  scope: string,
  limit: number,
  windowMs: number
): Promise<void> {
  const ip = await clientIp();
  if (!checkRateLimit(`${scope}:${ip}`, limit, windowMs)) {
    throw new Error(
      "Too many requests — please wait a minute and try again."
    );
  }
}
