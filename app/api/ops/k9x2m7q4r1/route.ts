/**
 * 临时运维接口 —— 仅用于在生产库执行 0007 迁移（去掉 RLS 的 FORCE）。
 *
 * 用完即删：执行成功后必须删除本文件并重新部署。
 * 访问需要携带 token，路径本身也不可枚举。
 */
import { NextResponse } from 'next/server';
import { client } from '@/lib/db/drizzle';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TOKEN = 'rls-maint-9f4a1c7e2b8d6350a4e1';

const TABLES = [
  'teams',
  'team_members',
  'ai_projects',
  'shops',
  'products',
  'orders',
  'ai_contents',
  'api_keys',
  'usage_records',
  'knowledge_entries',
  'service_sessions',
  'service_messages',
  'billing_ledger',
  'activity_logs',
  'invitations'
];

async function probeTeamsInsert() {
  try {
    await client.begin(async (sql) => {
      await sql`INSERT INTO "teams" ("name") VALUES ('__rls_probe_do_not_keep__')`;
      throw new Error('__rollback__');
    });
    return { inserted: true, rolledBack: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === '__rollback__') {
      return { inserted: true, rolledBack: true };
    }
    return { inserted: false, error: msg };
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (token !== TOKEN) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  const applied: string[] = [];
  const failed: { table: string; error: string }[] = [];

  for (const table of TABLES) {
    try {
      await client.unsafe(
        `ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`
      );
      applied.push(table);
    } catch (e) {
      failed.push({
        table,
        error: e instanceof Error ? e.message : String(e)
      });
    }
  }

  const list = TABLES.map((t) => `'${t}'`).join(', ');
  const tables = await client.unsafe(`
    SELECT c.relname AS "table",
           c.relrowsecurity AS "rlsEnabled",
           c.relforcerowsecurity AS "rlsForced"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN (${list})
    ORDER BY c.relname
  `);

  const probe = await probeTeamsInsert();

  return NextResponse.json({ applied, failed, tables, probe });
}