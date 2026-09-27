import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenantApi, requireRole } from '@/lib/auth/rbac';
import { getApiKeysForTeam } from '@/lib/db/queries';
import { createApiKey } from '@/lib/ai/apikey';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: z.string().datetime().optional().nullable(),
});

export async function GET() {
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const keys = await getApiKeysForTeam(ctx.team.id);
  return NextResponse.json(keys);
}

export async function POST(request: NextRequest) {
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    requireRole(ctx, 'admin');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = createSchema.parse(await request.json());
  const { plaintext } = await createApiKey(
    ctx.team.id,
    body.name,
    body.expiresAt ? new Date(body.expiresAt) : null
  );

  return NextResponse.json({ key: plaintext }, { status: 201 });
}
