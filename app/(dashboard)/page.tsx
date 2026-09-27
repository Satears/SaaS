import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { brand } from '@/lib/brand';
import {
  ArrowRight,
  Sparkles,
  Smartphone,
  PenLine,
  Megaphone,
  Headphones,
  Users,
  MessageCircle,
  Store,
  ShieldCheck,
  Repeat,
  QrCode,
  Crown
} from 'lucide-react';

const services = [
  {
    icon: Smartphone,
    title: '小程序搭建',
    desc: '商城 / 预约 / 会员小程序快速上线，零技术门槛，开箱即用，业务流程一次搭好。'
  },
  {
    icon: PenLine,
    title: 'AI 内容创作',
    desc: 'AI 自动写文案、做海报标题、生成短视频脚本与营销话术，内容不断更、风格可调。'
  },
  {
    icon: Headphones,
    title: 'AI 智能客服',
    desc: '7×24 小时自动应答售前售后，接入门店知识库精准作答，支持多轮对话。'
  },
  {
    icon: Users,
    title: '私域运营',
    desc: '会员拉新、社群维护、节日营销与复购唤醒全托管，把顾客留在自己的池子里。'
  }
];

const capabilities = [
  {
    icon: Store,
    title: '多门店统一管理',
    desc: '一个账号管多家门店，二级数据隔离、成员权限分明，连锁协作不掉线。'
  },
  {
    icon: QrCode,
    title: '小程序接入',
    desc: '商城 / 预约 / 会员三类小程序场景，统一接入门店与商品数据，打通线上线下一体化。'
  },
  {
    icon: MessageCircle,
    title: '营销与触达',
    desc: '活动策划、社群话术、朋友圈素材一键产出，按人群与渠道自动适配。'
  },
  {
    icon: ShieldCheck,
    title: '企业级安全',
    desc: '多租户隔离、角色权限（RBAC）、用量配额与限流、数据库行级安全策略。'
  }
];

const steps = [
  { step: '01', title: '开通与建档', desc: '录入门店与服务项目，或批量导入，AI 即时掌握你的生意。' },
  { step: '02', title: '搭建小程序', desc: '选择商城 / 预约 / 会员模板，快速上线属于自己的小程序。' },
  { step: '03', title: 'AI 全托管运营', desc: '文案、客服、营销、私域动作由 AI 自动执行，按套餐按需开启。' },
  { step: '04', title: '复盘与增长', desc: '经营看板实时呈现客流与转化，用量与账单透明可查。' }
];

export default function HomePage() {
  return (
    <main className="flex-1">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-orange-50/60 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-sm font-medium text-orange-600">
              <Sparkles className="h-4 w-4" />
              {brand.company} · 本地商家专属
            </span>
            <h1 className="mt-6 text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-gray-900">
              让每一家本地门店
              <span className="block text-orange-500">都有自己的 AI 运营团队</span>
            </h1>
            <p className="mt-6 text-lg text-gray-500 leading-8">
              {brand.name} 为本地商家提供小程序搭建 + AI 内容创作 + 私域运营的一站式代运营服务。
              从商城 / 预约 / 会员小程序上线，到 AI 自动写文案、做客服、发营销，全托管运营，
              让你零技术门槛也能玩转数字化生意。
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Button
                asChild
                size="lg"
                className="rounded-full bg-orange-600 hover:bg-orange-700 text-lg"
              >
                <Link href="/sign-up">
                  免费开始
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full text-lg">
                <Link href="/pricing">查看定价</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-gray-400">
              无需信用卡 · 体验版即可体验 AI 文案创作
            </p>
          </div>
        </div>
      </section>

      {/* 三大服务 */}
      <section id="services" className="py-16 bg-white border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-3xl font-bold text-gray-900">小程序 + AI 内容 + 私域，一站式代运营</h2>
            <p className="mt-3 text-gray-500">
              把「搭系统、做内容、维护客户」这些重复又专业的事，交给 {brand.shortName} 全托管。
            </p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {services.map((s) => (
              <div
                key={s.title}
                className="rounded-xl border border-gray-200 p-6 transition-shadow hover:shadow-md"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-orange-500 text-white">
                  <s.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-gray-900">{s.title}</h3>
                <p className="mt-2 text-sm text-gray-500 leading-6">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 平台能力 */}
      <section id="capabilities" className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="lg:grid lg:grid-cols-2 lg:gap-16 lg:items-center">
            <div>
              <h2 className="text-3xl font-bold text-gray-900">
                不只是 AI 工具，更是完整的代运营底座
              </h2>
              <p className="mt-4 text-gray-500 leading-7">
                从门店数据模型、权限隔离到用量计费，{brand.name} 把本地商家数字化经营所需的底层能力
                一次搭好，让你专注于把生意做得更好。
              </p>
              <div className="mt-8 grid gap-6 sm:grid-cols-2">
                {capabilities.map((c) => (
                  <div key={c.title} className="flex gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white text-orange-500 shadow-sm">
                      <c.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-gray-900">{c.title}</h3>
                      <p className="mt-1 text-sm text-gray-500 leading-6">{c.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-12 lg:mt-0">
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
                  上手流程
                </h3>
                <ol className="mt-6 space-y-5">
                  {steps.map((s) => (
                    <li key={s.step} className="flex gap-4">
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-semibold text-orange-600">
                        {s.step}
                      </span>
                      <div>
                        <p className="font-medium text-gray-900">{s.title}</p>
                        <p className="mt-0.5 text-sm text-gray-500">{s.desc}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 全托管说明 */}
      <section id="process" className="py-16 bg-white border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              {
                icon: Repeat,
                title: '全托管，不用自己动手',
                desc: '内容生产、客服应答、营销触达由 AI 按计划自动执行，商家只需确认与微调。'
              },
              {
                icon: Crown,
                title: '会员与私域沉淀',
                desc: '会员卡、储值、积分与社群一体运营，把每一次到店都变成可复购的长期客户。'
              },
              {
                icon: Megaphone,
                title: '营销活动即开即用',
                desc: '节日大促、开业活动、老客召回方案一键生成，配套话术与物料清单直接落地。'
              }
            ].map((item) => (
              <div key={item.title} className="rounded-xl bg-gray-50 p-6">
                <item.icon className="h-6 w-6 text-orange-500" />
                <h3 className="mt-4 text-lg font-semibold text-gray-900">{item.title}</h3>
                <p className="mt-2 text-sm text-gray-500 leading-6">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl bg-gray-900 px-8 py-12 text-center sm:px-16">
            <h2 className="text-3xl font-bold text-white">现在就让人工智能接管门店运营</h2>
            <p className="mt-3 text-gray-300">
              体验版免费可用，随时升级解锁 AI 营销策划、智能客服与私域运营能力。
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                asChild
                size="lg"
                className="rounded-full bg-orange-500 hover:bg-orange-600 text-lg"
              >
                <Link href="/sign-up">
                  免费开始
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-full text-lg border-gray-600 bg-transparent text-white hover:bg-gray-800 hover:text-white"
              >
                <Link href="/pricing">查看套餐</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}