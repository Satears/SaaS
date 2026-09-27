import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/drizzle';
import { aiProjects } from '@/lib/db/schema';
import { requireTenantApi, requireRole } from '@/lib/auth/rbac';
import { getAiProjectsForTeam } from '@/lib/db/queries';
import { checkProjectQuota } from '@/lib/billing/quota';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  model: z.string().max(100).optional(),
  systemPrompt: z.string().max(4000).optional(),
});

export async function GET() {
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projects = await getAiProjectsForTeam(ctx.team.id);
  return NextResponse.json(projects);
}

export async function POST(request: NextRequest) {
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 仅 owner/admin 可创建项目
  try {
    requireRole(ctx, 'admin');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = createSchema.parse(await request.json());

  // 项目数配额
  const existing = await getAiProjectsForTeam(ctx.team.id);
  const quotaCheck = await checkProjectQuota(ctx.team, existing.length);
  if (!quotaCheck.allowed) {
    return NextResponse.json({ error: quotaCheck.reason }, { status: 402 });
  }

  const [project] = await db
    .insert(aiProjects)
    .values({
      teamId: ctx.team.id,
      name: body.name,
      description: body.description ?? null,
      model: body.model ?? 'gpt-4o-mini',
      systemPrompt: body.systemPrompt ?? null,
    })
    .returning();

  return NextResponse.json(project, { status: 201 });
}
