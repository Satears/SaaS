import { NextResponse } from 'next/server';
import { requirePlatformAdminApi } from '@/lib/auth/rbac';
import { getAllTeamsWithStats, getAllUsersWithStats, getAllPlans } from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import { sql } from 'drizzle-orm';
import { usageRecords } from '@/lib/db/schema';

export async function GET() {
  const admin = await requirePlatformAdminApi();
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [teams, users, plans] = await Promise.all([
    getAllTeamsWithStats(),
    getAllUsersWithStats(),
    getAllPlans(),
  ]);

  const [usageAgg] = await db
    .select({
      totalTokens: sql<number>`COALESCE(SUM(input_tokens + output_tokens), 0)`,
      totalCalls: sql<number>`COUNT(*)`,
    })
    .from(usageRecords);

  return NextResponse.json({
    teams,
    users,
    plans,
    usage: {
      totalTokens: Number(usageAgg?.totalTokens ?? 0),
      totalCalls: Number(usageAgg?.totalCalls ?? 0),
    },
  });
}
