import 'server-only';
import { db } from '@/lib/db/drizzle';
import { usageRecords, type NewUsageRecord } from '@/lib/db/schema';
import { estimateCostCents } from './provider';

/**
 * 记录一次 AI 调用用量（写入 usage_records 表）。
 * 该记录是配额扣减与账单的基础。
 */
export async function recordUsage(params: {
  teamId: number;
  projectId?: number | null;
  apiKeyId?: number | null;
  kind: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  const id = await nextUsageId();
  const costCents = estimateCostCents(
    params.provider,
    params.model,
    params.inputTokens,
    params.outputTokens
  );

  const record: NewUsageRecord = {
    id,
    teamId: params.teamId,
    projectId: params.projectId ?? null,
    apiKeyId: params.apiKeyId ?? null,
    kind: params.kind,
    model: params.model,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    costCents,
  };

  await db.insert(usageRecords).values(record);
}

/**
 * 生成分布式安全的 usage id（bigint）。
 * 使用时间戳 + 随机数，避免依赖数据库序列。
 */
async function nextUsageId(): Promise<number> {
  const ts = BigInt(Date.now()) << 20n;
  const rand = BigInt(Math.floor(Math.random() * 0xfffff));
  return Number(ts | rand);
}
