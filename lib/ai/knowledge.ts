import 'server-only';
import { withTenantContext } from '@/lib/db/tenant';
import { eq, and, desc } from 'drizzle-orm';
import {
  knowledgeEntries,
  serviceSessions,
  serviceMessages,
  type NewKnowledgeEntry,
} from '@/lib/db/schema';
import { getEmbedder, cosineSimilarity } from './embedding';

/**
 * 客服知识库：FAQ 问答对管理 + 检索（RAG 预留）。
 * 检索采用关键词匹配（大小写不敏感），后续可升级为向量相似度检索。
 */

export async function listKnowledge(teamId: number, shopId?: number) {
  const conditions = [eq(knowledgeEntries.teamId, teamId)];
  if (shopId) conditions.push(eq(knowledgeEntries.shopId, shopId));
  return await withTenantContext(teamId, null, async (tx) => {
    return await tx
      .select()
      .from(knowledgeEntries)
      .where(and(...conditions))
      .orderBy(desc(knowledgeEntries.updatedAt));
  });
}

export async function createKnowledge(entry: NewKnowledgeEntry) {
  // 创建时自动生成向量（若字段未提供）
  if (!entry.embedding) {
    const embedder = getEmbedder();
    const text = `${entry.question}\n${entry.answer}`;
    entry.embedding = await embedder.embed(text);
  }
  return await withTenantContext(entry.teamId, null, async (tx) => {
    const [created] = await tx.insert(knowledgeEntries).values(entry).returning();
    return created;
  });
}

/** 允许被更新的字段白名单——防止把 teamId / id / shopId 一并改写。 */
export type KnowledgeUpdate = Partial<
  Pick<NewKnowledgeEntry, 'question' | 'answer' | 'category' | 'tags' | 'enabled'>
>;

export async function updateKnowledge(
  id: number,
  teamId: number,
  data: KnowledgeUpdate
) {
  return await withTenantContext(teamId, null, async (tx) => {
    const [updated] = await tx
      .update(knowledgeEntries)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(knowledgeEntries.id, id), eq(knowledgeEntries.teamId, teamId)))
      .returning();
    return updated;
  });
}

export async function deleteKnowledge(id: number, teamId: number) {
  await withTenantContext(teamId, null, async (tx) => {
    await tx
      .delete(knowledgeEntries)
      .where(and(eq(knowledgeEntries.id, id), eq(knowledgeEntries.teamId, teamId)));
  });
}

/**
 * 检索知识库：混合检索（向量语义相似度 + 关键词匹配）。
 *
 * 策略：
 * 1. 向量检索：对 query 生成 embedding，与已有 embedding 计算余弦相似度
 * 2. 关键词检索：ilike 模糊匹配（兜底）
 * 3. 两者结果去重合并，按相关度排序返回 Top-N
 */
export async function searchKnowledge(
  teamId: number,
  query: string,
  limit = 3,
  shopId?: number
) {
  const conditions = [eq(knowledgeEntries.teamId, teamId), eq(knowledgeEntries.enabled, true)];
  if (shopId) conditions.push(eq(knowledgeEntries.shopId, shopId));

  // 拉取候选集（全量，生产可加预过滤；此处条目量级小）
  const all = await withTenantContext(teamId, null, async (tx) => {
    return await tx
      .select()
      .from(knowledgeEntries)
      .where(and(...conditions));
  });

  if (all.length === 0) return [];

  // 1. 向量语义检索（embedding 是网络调用，置于事务之外）
  const embedder = getEmbedder();
  let scored: { entry: (typeof all)[number]; score: number }[] = [];

  try {
    const queryVec = await embedder.embed(query);
    for (const entry of all) {
      let sim = 0;
      if (entry.embedding && Array.isArray(entry.embedding)) {
        sim = cosineSimilarity(queryVec, entry.embedding as number[]);
      }
      scored.push({ entry, score: sim });
    }
  } catch {
    // embedding 失败时降级为关键词检索
    scored = all.map((entry) => ({ entry, score: 0 }));
  }

  // 2. 关键词匹配加分（与语义结果合并）
  const keywords = query
    .split(/\s+/)
    .filter((k) => k.length > 1)
    .slice(0, 5);

  for (const item of scored) {
    const q = item.entry.question.toLowerCase();
    const a = item.entry.answer.toLowerCase();
    let kwBonus = 0;
    for (const k of keywords) {
      const kl = k.toLowerCase();
      if (q.includes(kl) || a.includes(kl)) kwBonus += 0.5;
    }
    item.score = item.score * 0.7 + kwBonus; // 语义 70% + 关键词 30%
  }

  // 3. 排序取 Top-N（过滤掉完全无关的低分结果）
  scored.sort((x, y) => y.score - x.score);
  return scored
    .filter((s) => s.score > 0.05)
    .slice(0, limit)
    .map((s) => s.entry);
}

/**
 * 将知识库命中的条目拼接为上下文片段，注入客服提示词。
 */
export function knowledgeToContext(entries: { question: string; answer: string }[]): string {
  if (entries.length === 0) return '';
  return entries
    .map((e, i) => `【知识${i + 1}】\n问：${e.question}\n答：${e.answer}`)
    .join('\n\n');
}

// ─────────────────────────────────────────────
// 多轮会话管理
// ─────────────────────────────────────────────

export async function createSession(input: {
  teamId: number;
  shopId?: number | null;
  userId?: number | null;
  customerName?: string | null;
  language?: string;
}) {
  return await withTenantContext(input.teamId, input.userId ?? null, async (tx) => {
    const [session] = await tx
      .insert(serviceSessions)
      .values({
        teamId: input.teamId,
        shopId: input.shopId ?? null,
        userId: input.userId ?? null,
        customerName: input.customerName ?? null,
        language: input.language ?? 'zh',
      })
      .returning();
    return session;
  });
}

export async function getSession(sessionId: number, teamId: number) {
  return await withTenantContext(teamId, null, async (tx) => {
    const [session] = await tx
      .select()
      .from(serviceSessions)
      .where(and(eq(serviceSessions.id, sessionId), eq(serviceSessions.teamId, teamId)))
      .limit(1);
    return session ?? null;
  });
}

/**
 * 读取会话消息。service_messages 表本身没有 team_id 列，
 * 因此必须先校验会话归属租户，避免跨租户读取。
 * 会话校验与消息读取放进同一个事务（内联 getSession 逻辑，避免嵌套）。
 */
export async function getSessionMessages(
  sessionId: number,
  teamId: number,
  limit = 50
) {
  return await withTenantContext(teamId, null, async (tx) => {
    const [session] = await tx
      .select()
      .from(serviceSessions)
      .where(and(eq(serviceSessions.id, sessionId), eq(serviceSessions.teamId, teamId)))
      .limit(1);
    if (!session) return [];

    return await tx
      .select()
      .from(serviceMessages)
      .where(eq(serviceMessages.sessionId, sessionId))
      .orderBy(serviceMessages.createdAt)
      .limit(limit);
  });
}

export async function appendMessage(input: {
  sessionId: number;
  teamId: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokens?: number;
}) {
  // 同上：写入前校验会话归属，防止向他人会话追加消息
  // 会话校验与消息写入放进同一个事务（内联 getSession 逻辑，避免嵌套）。
  return await withTenantContext(input.teamId, null, async (tx) => {
    const [session] = await tx
      .select()
      .from(serviceSessions)
      .where(
        and(
          eq(serviceSessions.id, input.sessionId),
          eq(serviceSessions.teamId, input.teamId)
        )
      )
      .limit(1);
    if (!session) {
      throw new Error('Session not found in team');
    }

    const [msg] = await tx
      .insert(serviceMessages)
      .values({
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        tokens: input.tokens ?? 0,
      })
      .returning();
    return msg;
  });
}

export async function listSessions(teamId: number) {
  return await withTenantContext(teamId, null, async (tx) => {
    return await tx
      .select()
      .from(serviceSessions)
      .where(eq(serviceSessions.teamId, teamId))
      .orderBy(serviceSessions.updatedAt);
  });
}

export async function updateSessionStatus(
  sessionId: number,
  teamId: number,
  status: 'open' | 'resolved' | 'escalated'
) {
  await withTenantContext(teamId, null, async (tx) => {
    await tx
      .update(serviceSessions)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(serviceSessions.id, sessionId), eq(serviceSessions.teamId, teamId)));
  });
}
