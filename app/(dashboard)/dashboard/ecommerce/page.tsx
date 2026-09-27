'use client';

import Link from 'next/link';
import useSWR from 'swr';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Store,
  Package,
  ShoppingCart,
  PenLine,
  Megaphone,
  Headphones,
  BarChart3,
  Sparkles,
} from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type Capabilities = {
  planName: string;
  planTier: string;
  features: {
    copywriting: boolean;
    marketing: boolean;
    customerService: boolean;
    analytics: boolean;
  };
  quota: Record<string, number>;
};

const scenes = [
  {
    id: 'copywriting',
    href: '/dashboard/ecommerce/copywriting',
    name: 'AI文案创作',
    desc: '宣传文案、种草笔记、详情页、SEO 描述',
    icon: PenLine,
    color: 'bg-orange-100 text-orange-600',
  },
  {
    id: 'marketing',
    href: '/dashboard/ecommerce/marketing',
    name: 'AI营销策划',
    desc: '促销方案、社媒帖子、短视频脚本',
    icon: Megaphone,
    color: 'bg-purple-100 text-purple-600',
  },
  {
    id: 'customerService',
    href: '/dashboard/ecommerce/service',
    name: 'AI智能客服',
    desc: '售前售后问答、私域客服话术',
    icon: Headphones,
    color: 'bg-blue-100 text-blue-600',
  },
  {
    id: 'analytics',
    href: '/dashboard/ecommerce/analytics',
    name: '经营数据洞察',
    desc: '经营解读、选品建议、同行分析',
    icon: BarChart3,
    color: 'bg-green-100 text-green-600',
  },
] as const;

type Analytics = {
  stats: {
    shopCount: number;
    productCount: number;
    orderCount: number;
    totalRevenue: number;
  };
};

export default function EcommerceHome() {
  const { data: caps } = useSWR<Capabilities>('/api/plan', fetcher);
  const { data: shops } = useSWR<any[]>('/api/ecommerce/shops', fetcher);
  const { data: analytics } = useSWR<Analytics>(
    '/api/ecommerce/analytics',
    fetcher
  );

  return (
    <section className="flex-1 p-4 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-medium flex items-center gap-2">
          <Store className="h-6 w-6 text-orange-500" />
          商家运营工作台
        </h1>
        <span className="px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-700">
          当前套餐：{caps?.planName ?? 'Free'}
        </span>
      </div>

      {/* 数据概览 */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <Store className="h-8 w-8 text-orange-500" />
            <div>
              <p className="text-2xl font-bold">
                {analytics?.stats?.shopCount ?? shops?.length ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">门店</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <Package className="h-8 w-8 text-blue-500" />
            <div>
              <p className="text-2xl font-bold">
                {analytics?.stats?.productCount ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">商品</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <ShoppingCart className="h-8 w-8 text-green-500" />
            <div>
              <p className="text-2xl font-bold">
                {analytics?.stats?.orderCount ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">订单</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI 场景入口 */}
      <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-orange-500" />
        AI 能力
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {scenes.map((scene) => {
          const enabled = caps?.features?.[scene.id] ?? false;
          return (
            <Link key={scene.id} href={enabled ? scene.href : '/pricing'}>
              <Card
                className={`transition-all ${
                  enabled ? 'hover:shadow-md cursor-pointer' : 'opacity-60'
                }`}
              >
                <CardContent className="pt-4 flex items-start gap-4">
                  <div
                    className={`p-3 rounded-lg ${scene.color} flex-shrink-0`}
                  >
                    <scene.icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{scene.name}</p>
                      {!enabled && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-700">
                          升级解锁
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {scene.desc}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
