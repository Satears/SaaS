import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenantApi } from '@/lib/auth/rbac';
import {
  runSceneCompletion,
  FeatureNotAllowedError,
} from '@/lib/ai/ecommerce';
import {
  isAiSceneId,
  buildCopywritingPrompt,
  buildMarketingPrompt,
  buildCustomerServicePrompt,
  buildAnalyticsPrompt,
} from '@/lib/ai/scenes';
import { getProductById } from '@/lib/db/queries';
import { rateLimit } from '@/lib/security/rate-limit';

const baseSchema = z.object({
  scene: z.string(),
  shopId: z.number().int().positive().optional().nullable(),
  productId: z.number().int().positive().optional().nullable(),
});

// 各场景输入字段
const copywritingSchema = baseSchema.extend({
  productTitle: z.string().min(1).max(200),
  productInfo: z.string().max(2000).optional(),
  keywords: z.string().max(500).optional(),
  tone: z.string().max(50).optional(),
  count: z.number().int().min(1).max(10).optional(),
});

const marketingSchema = baseSchema.extend({
  campaignGoal: z.string().min(1).max(500),
  targetAudience: z.string().max(200).optional(),
  channel: z.string().max(100).optional(),
  budget: z.string().max(50).optional(),
});

const serviceSchema = baseSchema.extend({
  customerQuestion: z.string().min(1).max(2000),
  productContext: z.string().max(2000).optional(),
  orderContext: z.string().max(1000).optional(),
  language: z.string().max(20).optional(),
});

const analyticsSchema = baseSchema.extend({
  question: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const ctx = await requireTenantApi();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rl = rateLimit(`ai:scene:${ctx.team.id}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || !isAiSceneId(body.scene)) {
    return NextResponse.json({ error: 'Invalid scene' }, { status: 400 });
  }

  try {
    let messages: { role: 'user'; content: string }[] = [];
    let inputText = '';

    switch (body.scene) {
      case 'copywriting': {
        const d = copywritingSchema.parse(body);
        inputText = buildCopywritingPrompt(d);
        messages = [{ role: 'user', content: inputText }];
        break;
      }
      case 'marketing': {
        const d = marketingSchema.parse(body);
        inputText = buildMarketingPrompt(d);
        messages = [{ role: 'user', content: inputText }];
        break;
      }
      case 'customer_service': {
        const d = serviceSchema.parse(body);
        // 若带 productId，自动带入商品上下文
        let productContext = d.productContext;
        if (!productContext && d.productId) {
          const product = await getProductById(d.productId, ctx.team.id);
          if (product) {
            productContext = `${product.title}。${product.description ?? ''}`;
          }
        }
        inputText = buildCustomerServicePrompt({
          customerQuestion: d.customerQuestion,
          productContext,
          orderContext: d.orderContext,
          language: d.language,
        });
        messages = [{ role: 'user', content: inputText }];
        break;
      }
      case 'analytics': {
        const d = analyticsSchema.parse(body);
        const { getEcommerceStats } = await import('@/lib/db/queries');
        const stats = await getEcommerceStats(ctx.team.id);
        const summary = `门店数 ${stats.shopCount}、商品数 ${stats.productCount}、订单数 ${stats.orderCount}、累计销售额 ¥${stats.totalRevenue.toFixed(2)}。`;
        inputText = buildAnalyticsPrompt({
          dataSummary: summary,
          question: d.question,
        });
        messages = [{ role: 'user', content: inputText }];
        break;
      }
    }

    const result = await runSceneCompletion({
      teamId: ctx.team.id,
      scene: body.scene,
      messages,
      shopId: body.shopId ?? null,
      productId: body.productId ?? null,
      inputText,
    });

    return NextResponse.json(result);
  } catch (e: any) {
    if (e instanceof FeatureNotAllowedError) {
      return NextResponse.json({ error: e.message }, { status: 402 });
    }
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }
    console.error('AI scene error:', e);
    return NextResponse.json({ error: 'AI service error' }, { status: 500 });
  }
}
