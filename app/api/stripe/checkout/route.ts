import { eq, asc } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { teams, teamMembers } from '@/lib/db/schema';
import { getUser } from '@/lib/db/queries';
import { NextRequest, NextResponse } from 'next/server';
import { stripe, mapPlanNameToTier } from '@/lib/payments/stripe';
import Stripe from 'stripe';

/**
 * Stripe Checkout 成功回调（浏览器重定向，必须是 GET）。
 *
 * 安全要点：
 * - 必须已登录，且 Stripe 会话的 client_reference_id 与当前登录用户一致；
 * - 命中团队必须与 Stripe 客户一致；
 * - 绝不再凭 session_id 为用户铸造登录会话（否则等于账号接管入口）。
 *   未登录时也不影响订阅生效——订阅状态由 webhook 落库（见 webhook/route.ts）。
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const sessionId = searchParams.get('session_id');

  if (!sessionId) {
    return NextResponse.redirect(new URL('/pricing', request.url));
  }

  try {
    const currentUser = await getUser();
    if (!currentUser) {
      // 订阅会由 webhook 落库，这里只要求用户重新登录后查看
      return NextResponse.redirect(new URL('/sign-in', request.url));
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['customer', 'subscription'],
    });

    // 归属校验 1：会话必须由当前用户发起
    if (session.client_reference_id !== currentUser.id.toString()) {
      console.error('Checkout session does not belong to current user.');
      return NextResponse.redirect(new URL('/pricing', request.url));
    }

    if (!session.customer || typeof session.customer === 'string') {
      throw new Error('Invalid customer data from Stripe.');
    }

    const customerId = session.customer.id;
    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;

    if (!subscriptionId) {
      throw new Error('No subscription found for this session.');
    }

    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price.product'],
    });

    const plan = subscription.items.data[0]?.price;

    if (!plan) {
      throw new Error('No plan found for this subscription.');
    }

    const productId = (plan.product as Stripe.Product).id;

    if (!productId) {
      throw new Error('No product ID found for this subscription.');
    }

    const userTeam = await db
      .select({
        teamId: teamMembers.teamId,
        stripeCustomerId: teams.stripeCustomerId,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.userId, currentUser.id))
      .orderBy(asc(teamMembers.id))
      .limit(1);

    if (userTeam.length === 0) {
      throw new Error('User is not associated with any team.');
    }

    // 归属校验 2：团队绑定的 Stripe 客户必须与该会话一致
    const { teamId, stripeCustomerId } = userTeam[0];
    if (stripeCustomerId && stripeCustomerId !== customerId) {
      console.error('Stripe customer does not match team binding.');
      return NextResponse.redirect(new URL('/pricing', request.url));
    }

    const productName = (plan.product as Stripe.Product).name;

    await db
      .update(teams)
      .set({
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        stripeProductId: productId,
        planName: productName,
        planTier: mapPlanNameToTier(productName) as any,
        subscriptionStatus: subscription.status as any,
        updatedAt: new Date(),
      })
      .where(eq(teams.id, teamId));

    return NextResponse.redirect(new URL('/dashboard', request.url));
  } catch (error) {
    console.error('Error handling successful checkout:', error);
    return NextResponse.redirect(new URL('/pricing', request.url));
  }
}