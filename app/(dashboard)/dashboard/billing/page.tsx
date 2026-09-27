'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CreditCard, TrendingUp, Receipt, Loader2, FileText } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function formatCents(cents: number, currency = 'usd') {
  const sym = currency === 'cny' ? '¥' : '$';
  return `${sym}${(cents / 100).toFixed(2)}`;
}

export default function BillingPage() {
  const { data, mutate } = useSWR<any>('/api/billing/usage', fetcher);
  const [settling, setSettling] = useState(false);
  const [settleMsg, setSettleMsg] = useState<string | null>(null);

  const current = data?.current;
  const ledger = data?.ledger ?? [];
  const outstanding = data?.outstandingOverageCents ?? 0;

  const pct = current?.quotaTokens > 0
    ? Math.min(100, Math.round((current.totalTokens / current.quotaTokens) * 100))
    : 0;

  const hasPending = ledger.some((e: any) => e.status === 'pending' && e.amountCents > 0);

  async function settle() {
    if (settling) return;
    setSettling(true);
    setSettleMsg(null);
    try {
      const res = await fetch('/api/billing/settle', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '结算失败');
      const invoiced = data.results?.filter((r: any) => r.status === 'invoiced').length ?? 0;
      setSettleMsg(`已结算：${invoiced} 笔账单转为发票`);
      mutate();
    } catch (e: any) {
      setSettleMsg(`结算失败：${e.message}`);
    } finally {
      setSettling(false);
    }
  }

  return (
    <section className="flex-1 p-4 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-medium mb-6 flex items-center gap-2">
        <CreditCard className="h-6 w-6 text-orange-500" />
        用量与计费
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">本月用量</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {(current?.totalTokens ?? 0).toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">token（含输入+输出）</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">套餐配额</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {(current?.quotaTokens ?? 0).toLocaleString()}
            </p>
            <div className="w-full bg-muted rounded-full h-2 mt-2">
              <div
                className="bg-orange-500 h-2 rounded-full"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">已用 {pct}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">超额待付</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatCents(outstanding)}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              超出配额部分按量计费
            </p>
          </CardContent>
        </Card>
      </div>

      {current && current.overageTokens > 0 && (
        <Card className="mb-6 border-orange-200">
          <CardContent className="py-4">
            <p className="font-medium text-orange-600">本月已超额 {current.overageTokens.toLocaleString()} token</p>
            <p className="text-sm text-muted-foreground">
              预计超额费用 {formatCents(current.amountCents)}，将在账单周期结束时结算。
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            账单明细
          </CardTitle>
          {hasPending && (
            <Button
              variant="outline"
              size="sm"
              onClick={settle}
              disabled={settling}
            >
              {settling ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <FileText className="mr-1 h-4 w-4" />
              )}
              结算超额账单
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {settleMsg && (
            <p className="text-sm text-muted-foreground mb-3">{settleMsg}</p>
          )}
          {!ledger.length && (
            <p className="text-muted-foreground text-sm">暂无账单记录</p>
          )}
          <div className="space-y-3">
            {ledger.map((entry: any) => (
              <div
                key={entry.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div>
                  <p className="font-medium text-sm">{entry.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.period} · {entry.overageTokens.toLocaleString()} token 超额
                    {entry.stripeInvoiceId && ` · 发票 ${entry.stripeInvoiceId.slice(0, 12)}…`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{formatCents(entry.amountCents, entry.currency)}</p>
                  <p className="text-xs text-muted-foreground capitalize">{entry.status}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
