/**
 * 临时运维接口 —— 仅用于确认生产库身份（分支 / 项目 / 主机 / 数据库）。
 * 用完即删。
 */
import { NextResponse } from 'next/server';
import { client } from '@/lib/db/drizzle';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TOKEN = 'rls-maint-9f4a1c7e2b8d6350a4e1';

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get('token') !== TOKEN) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  const [id] = await client`
    SELECT current_database() AS "database",
           current_user AS "role",
           current_setting('neon.branch_id', true) AS "branchId",
           current_setting('neon.project_id', true) AS "projectId",
           current_setting('neon.endpoint_id', true) AS "endpointId",
           inet_server_addr()::text AS "serverAddr"
  `;

  const [counts] = await client`
    SELECT count(*)::int AS "publicTables"
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `;

  const roles = await client`
    SELECT rolname FROM pg_roles
    WHERE rolname NOT LIKE 'pg\\_%'
    ORDER BY 1
  `;

  return NextResponse.json({
    identity: id,
    publicTables: counts.publicTables,
    roles: roles.map((r) => r.rolname)
  });
}