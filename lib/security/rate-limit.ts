import 'server-only';

/**
 * 速率限制。
 *
 * - 配置了 Upstash 凭据时，使用 Upstash Redis 做分布式计数（Vercel 多实例共享
 *   同一份计数，限流才真正生效）。走 REST 接口 + fetch，不引入额外依赖。
 *   凭据读取顺序：`UPSTASH_REDIS_REST_URL/TOKEN`（手工配置）优先，
 *   其次 `KV_REST_API_URL/TOKEN`（Vercel 的 Upstash 集成自动注入，用 KV_ 前缀）。
 * - 未配置或 Upstash 不可用时，退化为单实例内存计数（保证可用性，但多实例下会失效）。
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const store = new Map<string, Bucket>();

const UPSTASH_URL = (
  process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
)?.replace(/\/+$/, '');
const UPSTASH_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

/**
 * 检查并记录一次请求。返回是否允许。
 * @param key 限流键（如 `ip:1.2.3.4` 或 `apikey:xxx`）
 * @param limit 时间窗口内最大请求数
 * @param windowMs 时间窗口（毫秒）
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const distributed = await upstashRateLimit(key, limit, windowMs);
    if (distributed) {
      return distributed;
    }
    // 分布式存储异常时降级为本地限流，避免限流组件本身成为单点故障
  }

  return memoryRateLimit(key, limit, windowMs);
}

async function upstashRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult | null> {
  try {
    const redisKey = `ratelimit:${key}`;
    const first = await upstashPipeline([
      ['INCR', redisKey],
      ['PTTL', redisKey]
    ]);
    if (!first) return null;

    const count = Number(first[0]?.result ?? 0);
    let pttl = Number(first[1]?.result ?? -1);

    // 窗口的第一次计数（或 key 无过期时间）时设置过期，避免计数永不过期
    if (count === 1 || pttl < 0) {
      await upstashPipeline([['PEXPIRE', redisKey, windowMs]]);
      pttl = windowMs;
    }

    const resetAt = Date.now() + (pttl > 0 ? pttl : windowMs);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt
    };
  } catch {
    return null;
  }
}

async function upstashPipeline(
  commands: (string | number)[][]
): Promise<{ result?: unknown; error?: string }[] | null> {
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(commands),
    cache: 'no-store'
  });

  if (!res.ok) {
    return null;
  }

  return (await res.json()) as { result?: unknown; error?: string }[];
}

function memoryRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    const bucket: Bucket = { count: 1, resetAt: now + windowMs };
    store.set(key, bucket);
    return { allowed: true, remaining: limit - 1, resetAt: bucket.resetAt };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: limit - existing.count,
    resetAt: existing.resetAt
  };
}

/**
 * 定期清理过期桶，防止内存泄漏。
 */
if (!UPSTASH_URL && typeof setInterval === 'function') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of store.entries()) {
      if (bucket.resetAt <= now) {
        store.delete(key);
      }
    }
  }, 60_000).unref?.();
}