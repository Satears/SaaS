/**
 * 临时运维接口 —— 仅用于在生产库修复 0006 引入的 RLS 故障。
 *
 * 用完即删：执行成功后必须删除本文件并重新部署。
 * 访问需要携带 token，路径本身也不可枚举。
 *
 * 用法：
 *   GET ?token=...               → 诊断：连接角色、表 owner、RLS 状态
 *   GET ?token=...&mode=disable  → 尝试关闭 RLS（DISABLE ROW LEVEL SECURITY）
 *                                  会先 SET LOCAL ROLE 到表 owner
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

const tableList = TABLES.map((t) => `'${t}'`).join(', ');

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get('token') !== TOKEN) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  const mode = url.searchParams.get('mode');

  const [role] = await client`
    SELECT current_user AS "currentUser",
           session_user AS "sessionUser",
           current_setting('is_superuser') AS "isSuperuser"
  `;

  const tables = await client.unsafe(`
    SELECT c.relname AS "table",
           pg_get_userbyid(c.relowner) AS "owner",
           c.relrowsecurity AS "rlsEnabled",
           c.relforcerowsecurity AS "rlsForced",
           pg_has_role(current_user, c.relowner, 'MEMBER') AS "memberOfOwner"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN (${tableList})
    ORDER BY c.relname
  `);

  const owners = Array.from(new Set(tables.map((t) => t.owner as string)));

  const out: Record<string, unknown> = { role, owners, tables };

  if (mode === 'disable') {
    const results: { owner: string; applied: string[]; error?: string }[] = [];

    for (const owner of owners) {
      try {
        const applied = await client.begin(async (sql) => {
          await sql.unsafe(`SET LOCAL ROLE "${owner}"`);
          const done: string[] = [];
          for (const t of TABLES) {
            await sql.unsafe(
              `ALTER TABLE "${t}" DISABLE ROW LEVEL SECURITY`
            );
            done.push(t);
          }
          return done;
        });
        results.push({ owner, applied });
      } catch (e) {
        results.push({
          owner,
          applied: [],
          error: e instanceof Error ? e.message : String(e)
        });
      }
    }

    out.disableResults = results;

    out.tablesAfter = await client.unsafe(`
      SELECT c.relname AS "table",
             c.relrowsecurity AS "rlsEnabled",
             c.relforcerowsecurity AS "rlsForced"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN (${tableList})
      ORDER BY c.relname
    `);

    try {
      await client.begin(async (sql) => {
        await sql`INSERT INTO "teams" ("name") VALUES ('__rls_probe_do_not_keep__')`;
        throw new Error('__rollback__');
      });
      out.probe = { inserted: true, rolledBack: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.probe =
        msg === '__rollback__'
          ? { inserted: true, rolledBack: true }
          : { inserted: false, error: msg };
    }
  }

  return NextResponse.json(out);
}