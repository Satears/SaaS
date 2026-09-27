import 'server-only';

/**
 * 简单的内存级速率限制器（单实例）。
 * 生产环境建议替换为 Redis 等分布式方案。
 */

type Bucket = {
  count: number;
  resetAt: number;
};

const store = new Map<string, Bucket>();

/**
 * 检查并记录一次请求。返回是否允许。
 * @param key 限流键（如 `ip:1.2.3.4` 或 `apikey:xxx`）
 * @param limit 时间窗口内最大请求数
 * @param windowMs 时间窗口（毫秒）
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAt: number } {
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
      resetAt: existing.resetAt,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
  };
}

/**
 * 定期清理过期桶，防止内存泄漏。
 */
if (typeof setInterval === 'function') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of store.entries()) {
      if (bucket.resetAt <= now) {
        store.delete(key);
      }
    }
  }, 60_000).unref?.();
}
