'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  BarChart3,
  Loader2,
  Copy,
  Sparkles,
  TrendingUp,
  DollarSign,
  Package,
  ShoppingCart,
} from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

// ─────────────────────────────────────────────
// 轻量 SVG 图表组件（零依赖）
// ─────────────────────────────────────────────

const CHART_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#eab308', '#ef4444', '#14b8a6', '#ec4899'];

function BarChart({
  data,
  color = '#f97316',
}: {
  data: { label: string; value: number }[];
  color?: string;
}) {
  if (!data.length) return <EmptyChart />;
  const max = Math.max(...data.map((d) => d.value), 1);
  const h = 200;
  const barW = 36;
  const gap = 12;
  const w = Math.max(data.length * (barW + gap), 320);

  return (
    <div className="overflow-x-auto">
      <svg width={w} height={h + 40} className="mx-auto">
        {data.map((d, i) => {
          const bh = (d.value / max) * h;
          const x = i * (barW + gap);
          return (
            <g key={i}>
              <rect
                x={x}
                y={h - bh}
                width={barW}
                height={bh}
                rx={4}
                fill={color}
                opacity={0.9}
              >
                <title>{`${d.label}: ${d.value}`}</title>
              </rect>
              <text
                x={x + barW / 2}
                y={h - bh - 6}
                textAnchor="middle"
                fontSize="11"
                fill="#888"
              >
                {d.value}
              </text>
              <text
                x={x + barW / 2}
                y={h + 16}
                textAnchor="middle"
                fontSize="10"
                fill="#aaa"
              >
                {d.label.length > 6 ? d.label.slice(0, 6) + '…' : d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function LineChart({ data }: { data: { label: string; value: number }[] }) {
  if (!data.length) return <EmptyChart />;
  const w = 560;
  const h = 200;
  const pad = 30;
  const max = Math.max(...data.map((d) => d.value), 1);
  const stepX = (w - pad * 2) / Math.max(data.length - 1, 1);

  const points = data.map((d, i) => ({
    x: pad + i * stepX,
    y: h - pad - (d.value / max) * (h - pad * 2),
  }));

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const area = `${path} L${points[points.length - 1].x},${h - pad} L${points[0].x},${h - pad} Z`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full">
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#areaGrad)" />
      <path d={path} fill="none" stroke="#f97316" strokeWidth="2" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="#f97316">
          <title>{`${data[i].label}: ${data[i].value}`}</title>
        </circle>
      ))}
      {data.map((d, i) => (
        <text
          key={i}
          x={pad + i * stepX}
          y={h - 8}
          textAnchor="middle"
          fontSize="10"
          fill="#aaa"
        >
          {d.label}
        </text>
      ))}
    </svg>
  );
}

function DonutChart({ data }: { data: { label: string; value: number }[] }) {
  if (!data.length) return <EmptyChart />;
  const total = data.reduce((a, d) => a + d.value, 0);
  const r = 70;
  const cx = 90;
  const cy = 90;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-4 flex-wrap justify-center">
      <svg width={180} height={180} viewBox="0 0 180 180">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eee" strokeWidth="24" />
        {data.map((d, i) => {
          const frac = d.value / total;
          const dash = frac * circumference;
          const seg = (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth="24"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 90 90)"
            >
              <title>{`${d.label}: ${d.value}`}</title>
            </circle>
          );
          offset += dash;
          return seg;
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="22" fontWeight="bold" fill="#333">
          {total}
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" fontSize="11" fill="#aaa">
          总计
        </text>
      </svg>
      <div className="space-y-1.5">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span
              className="w-3 h-3 rounded-full inline-block"
              style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
            />
            <span className="text-muted-foreground">{d.label}</span>
            <span className="font-medium ml-auto">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyChart() {
  return (
    <p className="text-sm text-muted-foreground text-center py-12">
      暂无数据，导入商品或订单后即可看到图表
    </p>
  );
}

// ─────────────────────────────────────────────
// 页面主体
// ─────────────────────────────────────────────

export default function AnalyticsPage() {
  const { data } = useSWR<any>('/api/ecommerce/analytics', fetcher);
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stats = data?.stats;
  const trend = data?.trend ?? [];
  const topProducts = data?.topProducts ?? [];
  const categories = data?.categories ?? [];
  const statusBreakdown = data?.statusBreakdown ?? [];

  async function analyze() {
    if (loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/ai/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: 'analytics', question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '分析失败');
      setResult(data.content);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const kpi = [
    { label: '门店数', value: stats?.shopCount ?? 0, icon: ShoppingCart, color: 'text-blue-500' },
    { label: '商品数', value: stats?.productCount ?? 0, icon: Package, color: 'text-green-500' },
    { label: '订单数', value: stats?.orderCount ?? 0, icon: BarChart3, color: 'text-orange-500' },
    {
      label: '销售额',
      value: `¥${(stats?.totalRevenue ?? 0).toLocaleString()}`,
      icon: DollarSign,
      color: 'text-purple-500',
    },
  ];

  return (
    <section className="flex-1 p-4 lg:p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-medium mb-6 flex items-center gap-2">
        <BarChart3 className="h-6 w-6 text-green-500" />
        经营数据洞察
      </h1>

      {/* KPI 卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {kpi.map((k) => (
          <Card key={k.label}>
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <k.icon className={`h-4 w-4 ${k.color}`} />
                {k.label}
              </div>
              <p className="text-2xl font-semibold mt-1">{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 趋势折线图 */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-500" />
            近 14 天订单趋势
          </CardTitle>
        </CardHeader>
        <CardContent>
          <LineChart data={trend.map((t: any) => ({ label: t.day, value: t.orderCount }))} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* 商品销量 TOP */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">商品销量 TOP</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              data={topProducts.map((p: any) => ({ label: p.title, value: p.orderCount }))}
            />
          </CardContent>
        </Card>

        {/* 品类分布 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">商品品类分布</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart
              data={categories.map((c: any) => ({ label: c.category, value: c.count }))}
            />
          </CardContent>
        </Card>
      </div>

      {/* AI 洞察 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">AI 智能洞察</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>想了解什么？（可选，留空则综合解读以上数据）</Label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="如：为什么最近转化率下降？哪类商品最值得推广？"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <Button
            onClick={analyze}
            disabled={loading}
            className="bg-green-500 hover:bg-green-600 text-white"
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            生成洞察
          </Button>

          {result && (
            <div className="flex items-start justify-between gap-2">
              <div className="whitespace-pre-wrap text-sm leading-relaxed bg-gray-50 rounded-lg p-4 flex-1">
                {result}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigator.clipboard.writeText(result)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
