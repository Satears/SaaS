import Stripe from 'stripe';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { Team, plans } from '@/lib/db/schema';
import {
  getTeamByStripeCustomerId,
  getUser,
  updateTeamSubscription
} from '@/lib/db/queries';

// 未配置 STRIPE_SECRET_KEY 时使用占位符构造，避免模块加载即抛错；
// 真正调用 Stripe API 时才会失败（此时相关功能应已按“未配置”降级）。
export const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder_not_configured',
  {
    apiVersion: '2025-04-30.basil'
  }
);

export async function createCheckoutSession({
  team,
  priceId
}: {
  team: Team | null;
  priceId: string;
}) {
  const user = await getUser();

  if (!team || !user) {
    redirect(`/sign-up?redirect=checkout&priceId=${priceId}`);
  }

  // priceId 来自客户端表单，必须在服务端按 plans 表白名单校验，
  // 否则用户可提交任意 Stripe Price ID 下单。
  const [allowedPlan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.stripePriceId, priceId))
    .limit(1);

  if (!allowedPlan) {
    redirect('/pricing');
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1
      }
    ],
    mode: 'subscription',
    success_url: `${process.env.BASE_URL}/api/stripe/checkout?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.BASE_URL}/pricing`,
    customer: team.stripeCustomerId || undefined,
    client_reference_id: user.id.toString(),
    allow_promotion_codes: true,
    subscription_data: {
      trial_period_days: 14
    }
  });

  redirect(session.url!);
}

export async function createCustomerPortalSession(team: Team) {
  if (!team.stripeCustomerId || !team.stripeProductId) {
    redirect('/pricing');
  }

  let configuration: Stripe.BillingPortal.Configuration;
  const configurations = await stripe.billingPortal.configurations.list();

  if (configurations.data.length > 0) {
    configuration = configurations.data[0];
  } else {
    const product = await stripe.products.retrieve(team.stripeProductId);
    if (!product.active) {
      throw new Error("Team's product is not active in Stripe");
    }

    const prices = await stripe.prices.list({
      product: product.id,
      active: true
    });
    if (prices.data.length === 0) {
      throw new Error("No active prices found for the team's product");
    }

    configuration = await stripe.billingPortal.configurations.create({
      business_profile: {
        headline: 'Manage your subscription'
      },
      features: {
        subscription_update: {
          enabled: true,
          default_allowed_updates: ['price', 'quantity', 'promotion_code'],
          proration_behavior: 'create_prorations',
          products: [
            {
              product: product.id,
              prices: prices.data.map((price) => price.id)
            }
          ]
        },
        subscription_cancel: {
          enabled: true,
          mode: 'at_period_end',
          cancellation_reason: {
            enabled: true,
            options: [
              'too_expensive',
              'missing_features',
              'switched_service',
              'unused',
              'other'
            ]
          }
        },
        payment_method_update: {
          enabled: true
        }
      }
    });
  }

  return stripe.billingPortal.sessions.create({
    customer: team.stripeCustomerId,
    return_url: `${process.env.BASE_URL}/dashboard`,
    configuration: configuration.id
  });
}

export async function handleSubscriptionChange(
  subscription: Stripe.Subscription
) {
  const customerId = subscription.customer as string;
  const subscriptionId = subscription.id;
  const status = subscription.status;

  const team = await getTeamByStripeCustomerId(customerId);

  if (!team) {
    console.error('Team not found for Stripe customer:', customerId);
    return;
  }

  if (status === 'active' || status === 'trialing') {
    const item = subscription.items.data[0];
    // 新版 API 中 items[].plan 已废弃，优先取 price.product。
    // webhook 载荷里 product 未 expand 时是字符串 ID，必须再查一次名称：
    // 否则 productName 为空会把付费租户错误降级为 free。
    const rawProduct = item?.price?.product ?? item?.plan?.product;
    const productId =
      typeof rawProduct === 'string' ? rawProduct : rawProduct?.id ?? null;
    let productName =
      rawProduct && typeof rawProduct === 'object' && 'name' in rawProduct
        ? rawProduct.name
        : '';

    if (productId && !productName) {
      try {
        productName = (await stripe.products.retrieve(productId)).name;
      } catch (error) {
        console.error('Failed to resolve Stripe product name:', productId, error);
      }
    }

    await updateTeamSubscription(team.id, {
      stripeSubscriptionId: subscriptionId,
      stripeProductId: productId,
      // 名称解析失败时保留租户原有套餐，避免误降级
      planName: productName || team.planName,
      subscriptionStatus: status,
      planTier: productName ? mapPlanNameToTier(productName) : team.planTier
    });
  } else if (status === 'canceled' || status === 'unpaid') {
    await updateTeamSubscription(team.id, {
      stripeSubscriptionId: null,
      stripeProductId: null,
      planName: null,
      subscriptionStatus: status,
      planTier: 'free'
    });
  }
}

/**
 * 将 Stripe product name 映射为 plan tier（大小写不敏感）。
 */
export function mapPlanNameToTier(planName: string): string {
  const n = planName.toLowerCase();
  if (n.includes('enterprise')) return 'enterprise';
  if (n.includes('business')) return 'business';
  if (n.includes('pro') || n.includes('plus')) return 'pro';
  return 'free';
}

export async function getStripePrices() {
  const prices = await stripe.prices.list({
    expand: ['data.product'],
    active: true,
    type: 'recurring'
  });

  return prices.data.map((price) => ({
    id: price.id,
    productId:
      typeof price.product === 'string' ? price.product : price.product.id,
    unitAmount: price.unit_amount,
    currency: price.currency,
    interval: price.recurring?.interval,
    trialPeriodDays: price.recurring?.trial_period_days
  }));
}

export async function getStripeProducts() {
  const products = await stripe.products.list({
    active: true,
    expand: ['data.default_price']
  });

  return products.data.map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description,
    defaultPriceId:
      typeof product.default_price === 'string'
        ? product.default_price
        : product.default_price?.id
  }));
}
