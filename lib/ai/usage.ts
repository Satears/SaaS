import 'server-only';
import { withTenantContext, type TenantTx } from '@/lib/db/tenant';
import { usageRecords, type NewUsageRecord } from '@/lib/db/schema';
import { estimateCostCents } from './provider';

/**
 * 记录一次 AI 调用用量（写入 usage_records 表）。
 * 该记录是配额扣减与账单的基础。
 *
 * @param tx 若调用方已处于租户上下文事务中，传入该事务句柄复用（避免嵌套 begin）。
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
}, tx?: TenantTx): Promise<void> {
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

  if (tx) {
    await tx.insert(usageRecords).values(record);
    return;
  }
  await withTenantContext(params.teamId, null, async (t) => {
    await t.insert(usageRecords).values(record);
  });
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
