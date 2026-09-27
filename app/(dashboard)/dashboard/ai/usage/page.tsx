'use client';

import useSWR from 'swr';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { BarChart3, Gauge, Activity } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type UsageData = {
  quota: {
    quotaTokenMonthly: number;
    quotaProjects: number;
    quotaMembers: number;
    quotaApiCallsDaily: number;
  };
  usage: { monthlyTokens: number; dailyApiCalls: number };
  recent: any[];
};

export default function UsagePage() {
  const { data } = useSWR<UsageData>('/api/ai/usage', fetcher);

  if (!data) {
    return (
      <section className="flex-1 p-4 lg:p-8">
        <p className="text-muted-foreground">加载中…</p>
      </section>
    );
  }

  const tokenPct =
    data.quota.quotaTokenMonthly > 0
      ? Math.min(100, (data.usage.monthlyTokens / data.quota.quotaTokenMonthly) * 100)
      : 0;

  const apiPct =
    data.quota.quotaApiCallsDaily > 0
      ? Math.min(100, (data.usage.dailyApiCalls / data.quota.quotaApiCallsDaily) * 100)
      : 0;

  return (
    <section className="flex-1 p-4 lg:p-8">
      <h1 className="text-lg lg:text-2xl font-medium mb-6 flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-orange-500" />
        用量统计
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Gauge className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">本月 Token 用量</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {data.usage.monthlyTokens.toLocaleString()}
              <span className="text-sm font-normal text-muted-foreground">
                {' '}
                / {data.quota.quotaTokenMonthly.toLocaleString()}
              </span>
            </p>
            <div className="mt-3 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-500 rounded-full transition-all"
                style={{ width: `${tokenPct}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              已使用 {tokenPct.toFixed(1)}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">今日 API 调用</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {data.usage.dailyApiCalls.toLocaleString()}
              <span className="text-sm font-normal text-muted-foreground">
                {' '}
                / {data.quota.quotaApiCallsDaily.toLocaleString()}
              </span>
            </p>
            <div className="mt-3 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${apiPct}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              已使用 {apiPct.toFixed(1)}%
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">最近调用记录</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">时间</th>
                  <th className="py-2 pr-4 font-medium">类型</th>
                  <th className="py-2 pr-4 font-medium">模型</th>
                  <th className="py-2 pr-4 font-medium">输入 Token</th>
                  <th className="py-2 pr-4 font-medium">输出 Token</th>
                  <th className="py-2 pr-4 font-medium">成本</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="py-2 pr-4">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4">{r.kind}</td>
                    <td className="py-2 pr-4">{r.model}</td>
                    <td className="py-2 pr-4">{r.inputTokens}</td>
                    <td className="py-2 pr-4">{r.outputTokens}</td>
                    <td className="py-2 pr-4">
                      ¥{(r.costCents / 100).toFixed(4)}
                    </td>
                  </tr>
                ))}
                {data.recent.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 text-muted-foreground text-center">
                      暂无调用记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
