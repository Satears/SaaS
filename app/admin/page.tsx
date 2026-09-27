'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Building2, Users, Sparkles, CreditCard } from 'lucide-react';

type Stats = {
  teams: any[];
  users: any[];
  plans: any[];
  usage: { totalTokens: number; totalCalls: number };
};

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/stats')
      .then((r) => {
        if (r.status === 403) throw new Error('需要平台管理员权限');
        if (!r.ok) throw new Error('加载失败');
        return r.json();
      })
      .then(setStats)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-500">{error}</p>
        <Link href="/dashboard" className="text-blue-500 underline mt-4 inline-block">
          返回控制台
        </Link>
      </div>
    );
  }

  if (!stats) {
    return <div className="p-8 text-center text-muted-foreground">加载中…</div>;
  }

  const activeTeams = stats.teams.filter(
    (t) => t.subscriptionStatus === 'active' || t.subscriptionStatus === 'trialing'
  ).length;

  return (
    <section className="p-4 lg:p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-medium mb-6">平台管理后台</h1>

      {/* 概览卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">租户总数</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.teams.length}</p>
            <p className="text-xs text-muted-foreground">
              活跃订阅 {activeTeams} 个
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">用户总数</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.users.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">累计 AI Token</CardTitle>
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {stats.usage.totalTokens.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">
              {stats.usage.totalCalls.toLocaleString()} 次调用
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">订阅计划</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.plans.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* 订阅计划表 */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>订阅计划与配额</CardTitle>
          <CardDescription>各档位的默认配额配置</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">名称</th>
                  <th className="py-2 pr-4 font-medium">月费</th>
                  <th className="py-2 pr-4 font-medium">Token/月</th>
                  <th className="py-2 pr-4 font-medium">项目数</th>
                  <th className="py-2 pr-4 font-medium">成员数</th>
                  <th className="py-2 pr-4 font-medium">API/日</th>
                </tr>
              </thead>
              <tbody>
                {stats.plans.map((p) => (
                  <tr key={p.id} className="border-b">
                    <td className="py-2 pr-4 font-medium">{p.name}</td>
                    <td className="py-2 pr-4">
                      ¥{(p.priceMonthlyCents / 100).toFixed(2)}
                    </td>
                    <td className="py-2 pr-4">{p.quotaTokenMonthly.toLocaleString()}</td>
                    <td className="py-2 pr-4">{p.quotaProjects}</td>
                    <td className="py-2 pr-4">{p.quotaMembers}</td>
                    <td className="py-2 pr-4">{p.quotaApiCallsDaily}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 租户列表 */}
      <Card>
        <CardHeader>
          <CardTitle>租户列表</CardTitle>
          <CardDescription>所有租户及其订阅状态</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">ID</th>
                  <th className="py-2 pr-4 font-medium">名称</th>
                  <th className="py-2 pr-4 font-medium">计划</th>
                  <th className="py-2 pr-4 font-medium">状态</th>
                  <th className="py-2 pr-4 font-medium">成员</th>
                  <th className="py-2 pr-4 font-medium">创建时间</th>
                </tr>
              </thead>
              <tbody>
                {stats.teams.map((t) => (
                  <tr key={t.id} className="border-b">
                    <td className="py-2 pr-4">{t.id}</td>
                    <td className="py-2 pr-4 font-medium">{t.name}</td>
                    <td className="py-2 pr-4">{t.planTier}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs ${
                          t.subscriptionStatus === 'active'
                            ? 'bg-green-100 text-green-700'
                            : t.subscriptionStatus === 'trialing'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {t.subscriptionStatus}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{t.memberCount}</td>
                    <td className="py-2 pr-4">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
