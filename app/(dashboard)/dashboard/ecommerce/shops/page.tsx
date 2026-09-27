'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Store, PlusCircle, Trash2, Loader2, RefreshCw, Link2, Plug } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function ShopsPage() {
  const { data: shops, mutate } = useSWR<any[]>(
    '/api/ecommerce/shops',
    fetcher
  );
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('miniprogram');
  const [domain, setDomain] = useState('');
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createShop() {
    if (!name.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/ecommerce/shops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, platform, domain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '创建失败');
      setName('');
      setDomain('');
      mutate();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function deleteShop(id: number) {
    if (!confirm('确认删除该门店？')) return;
    await fetch(`/api/ecommerce/shops/${id}`, { method: 'DELETE' });
    mutate();
  }

  async function connectShop(shop: any) {
    setError(null);
    try {
      const res = await fetch('/api/ecommerce/oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: shop.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '该接入方式尚未实现');
        return;
      }
      window.location.href = data.authUrl;
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function syncShop(id: number) {
    if (syncing !== null) return;
    setSyncing(id);
    setError(null);
    try {
      const res = await fetch('/api/ecommerce/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '同步失败');
      alert(`同步完成：${data.products} 个商品，${data.orders} 个订单`);
      mutate();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSyncing(null);
    }
  }

  const statusLabel: Record<string, string> = {
    disconnected: '未接入',
    connected: '已接入',
    syncing: '同步中',
    error: '同步失败',
  };

  const platformLabel: Record<string, string> = {
    miniprogram: '小程序',
    douyin: '抖音',
    taobao: '淘宝',
    jd: '京东',
    pdd: '拼多多',
    shopify: 'Shopify',
    amazon: 'Amazon',
  };

  return (
    <section className="flex-1 p-4 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-medium mb-6 flex items-center gap-2">
        <Store className="h-6 w-6 text-orange-500" />
        门店管理
      </h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm">添加门店</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>门店名称 *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：某某门店"
              />
            </div>
            <div>
              <Label>接入渠道</Label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                <option value="miniprogram">小程序（商城 / 预约 / 会员）</option>
                <option value="douyin">抖音</option>
                <option value="taobao">淘宝</option>
                <option value="jd">京东</option>
                <option value="pdd">拼多多</option>
                <option value="shopify">Shopify</option>
                <option value="amazon">Amazon</option>
              </select>
            </div>
          </div>
          <div>
            <Label>门店信息（可选，用于区分不同门店 / 小程序）</Label>
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="如：门店编号或小程序名称"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <Button
            onClick={createShop}
            disabled={creating || !name.trim()}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {creating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <PlusCircle className="mr-2 h-4 w-4" />
            )}
            添加门店
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {!shops?.length && (
          <p className="text-muted-foreground">暂无门店，先添加一个吧</p>
        )}
        {shops?.map((s) => (
          <Card key={s.id}>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {platformLabel[s.platform] ?? s.platform}
                    {s.domain ? ` · ${s.domain}` : ''}
                  </p>
                  <p className="text-xs mt-1">
                    <span
                      className={`px-2 py-0.5 rounded-full ${
                        s.syncStatus === 'connected'
                          ? 'bg-green-100 text-green-700'
                          : s.syncStatus === 'error'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {statusLabel[s.syncStatus] ?? s.syncStatus}
                    </span>
                    {s.lastSyncedAt && (
                      <span className="text-muted-foreground ml-2">
                        最近同步 {new Date(s.lastSyncedAt).toLocaleString()}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {s.syncStatus === 'disconnected' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => connectShop(s)}
                    >
                      <Plug className="mr-1 h-4 w-4" />
                      接入小程序
                    </Button>
                  )}
                  {s.syncStatus === 'connected' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => syncShop(s.id)}
                      disabled={syncing !== null}
                    >
                      {syncing === s.id ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1 h-4 w-4" />
                      )}
                      同步
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => deleteShop(s.id)}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
