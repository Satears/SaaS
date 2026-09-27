import { getAllPlans } from '@/lib/db/queries';
import { checkoutAction } from '@/lib/payments/actions';
import { Check, Minus } from 'lucide-react';
import { SubmitButton } from './submit-button';

// 套餐从数据库读取，避免构建期静态化
export const dynamic = 'force-dynamic';

const TIER_LABEL: Record<string, string> = {
  free: '体验版',
  pro: '专业版',
  business: '商业版',
  enterprise: '企业版',
};

function formatTokens(n: number) {
  if (n >= 100000000) return `${Math.round(n / 100000000)} 亿`;
  if (n >= 10000) return `${Math.round(n / 10000)} 万`;
  return String(n);
}

function fmtPrice(cents: number) {
  if (cents === 0) return '免费';
  return `¥${(cents / 100).toFixed(0)}`;
}

export default async function PricingPage() {
  const plans = await getAllPlans();
  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-gray-900">选择适合你的套餐</h1>
        <p className="text-gray-600 mt-2">
          本地商家代运营能力按需订阅，随时升级或降级
        </p>
        {!stripeConfigured && (
          <p className="mt-4 inline-block rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-700">
            当前为本地演示环境（未配置 Stripe），套餐能力已生效，订阅支付暂不可用
          </p>
        )}
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {plans.map((plan) => {
          const features: { label: string; enabled: boolean }[] = [
            { label: 'AI 文案创作', enabled: plan.featureCopywriting },
            { label: 'AI 营销策划', enabled: plan.featureMarketing },
            { label: 'AI 智能客服', enabled: plan.featureCustomerService },
            { label: '经营数据洞察', enabled: plan.featureAnalytics },
            { label: `门店 ${plan.quotaShops} 个`, enabled: true },
            { label: `商品 ${plan.quotaProducts} 个`, enabled: true },
            { label: `每月 ${formatTokens(plan.quotaTokenMonthly)} Token`, enabled: true },
            { label: `成员 ${plan.quotaMembers} 人`, enabled: true },
          ];

          return (
            <div
              key={plan.id}
              className="flex flex-col rounded-lg border border-gray-200 p-6 shadow-sm"
            >
              <h2 className="text-xl font-semibold text-gray-900">
                {TIER_LABEL[plan.tier] ?? plan.name}
              </h2>
              <p className="text-sm text-gray-500 mt-1">{plan.description}</p>
              <p className="text-3xl font-bold text-gray-900 mt-4">
                {fmtPrice(plan.priceMonthlyCents)}
                {plan.priceMonthlyCents > 0 && (
                  <span className="text-base font-normal text-gray-500"> /月</span>
                )}
              </p>

              <ul className="mt-6 space-y-3 flex-1">
                {features.map((f, i) => (
                  <li key={i} className="flex items-start text-sm">
                    {f.enabled ? (
                      <Check className="h-4 w-4 text-orange-500 mr-2 mt-0.5 flex-shrink-0" />
                    ) : (
                      <Minus className="h-4 w-4 text-gray-300 mr-2 mt-0.5 flex-shrink-0" />
                    )}
                    <span className={f.enabled ? 'text-gray-700' : 'text-gray-400'}>
                      {f.label}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                {plan.stripePriceId ? (
                  <form action={checkoutAction}>
                    <input type="hidden" name="priceId" value={plan.stripePriceId} />
                    <SubmitButton />
                  </form>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="w-full rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-400 cursor-not-allowed"
                  >
                    {plan.priceMonthlyCents === 0 ? '默认可用' : '未接入支付'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
