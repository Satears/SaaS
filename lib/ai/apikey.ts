import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { apiKeys, type NewApiKey } from '@/lib/db/schema';
import { getApiKeyByHash } from '@/lib/db/queries';

const KEY_PREFIX = 'sk-saas';

/**
 * 生成一个新的 API Key（明文 + 哈希）。
 * 明文仅在创建时返回一次，数据库只存哈希。
 */
export function generateApiKey(): { plaintext: string; prefix: string; hash: string } {
  const secret = randomBytes(24).toString('base64url');
  const plaintext = `${KEY_PREFIX}_${secret}`;
  const prefix = plaintext.slice(0, 12);
  const hash = hashKey(plaintext);
  return { plaintext, prefix, hash };
}

export function hashKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * 创建并保存 API Key，返回明文（仅此一次）。
 */
export async function createApiKey(
  teamId: number,
  name: string,
  expiresAt?: Date | null
): Promise<{ plaintext: string }> {
  const { plaintext, prefix, hash } = generateApiKey();

  const record: NewApiKey = {
    teamId,
    name,
    keyPrefix: prefix,
    keyHash: hash,
    expiresAt: expiresAt ?? null,
  };

  await db.insert(apiKeys).values(record);
  return { plaintext };
}

/**
 * 校验 API Key 是否有效，返回对应的 apiKey 记录（含 teamId）。
 */
export async function validateApiKey(plaintext: string) {
  if (!plaintext || !plaintext.startsWith(KEY_PREFIX)) {
    return null;
  }
  const hash = hashKey(plaintext);
  const record = await getApiKeyByHash(hash);
  if (!record) return null;
  if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
    return null;
  }
  return record;
}

/**
 * 撤销 API Key。
 */
export async function revokeApiKey(keyId: number, teamId: number) {
  await db
    .update(apiKeys)
    .set({ isActive: false, revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.teamId, teamId)));
}
