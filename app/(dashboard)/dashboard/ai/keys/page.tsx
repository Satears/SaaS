'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Trash2, KeyRound, Copy, Loader2 } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type ApiKey = {
  id: number;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
};

export default function ApiKeysPage() {
  const { data: keys, mutate } = useSWR<ApiKey[]>('/api/ai/keys', fetcher);
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createKey() {
    if (!name.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '创建失败');
      setNewKey(data.key);
      setName('');
      mutate();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(id: number) {
    if (!confirm('确认撤销该 API Key？撤销后不可恢复。')) return;
    await fetch(`/api/ai/keys/${id}`, { method: 'DELETE' });
    mutate();
  }

  async function copyKey() {
    if (newKey) {
      await navigator.clipboard.writeText(newKey);
    }
  }

  return (
    <section className="flex-1 p-4 lg:p-8">
      <h1 className="text-lg lg:text-2xl font-medium mb-6 flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-orange-500" />
        API Key
      </h1>

      {/* 新 Key 提示 */}
      {newKey && (
        <Card className="mb-6 border-yellow-300 bg-yellow-50">
          <CardContent className="py-4">
            <p className="font-medium mb-2">
              API Key 已创建（仅显示一次，请妥善保存）：
            </p>
            <div className="flex gap-2">
              <code className="flex-1 bg-white border rounded-lg px-3 py-2 text-sm break-all">
                {newKey}
              </code>
              <Button variant="outline" size="sm" onClick={copyKey}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>创建 API Key</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="keyname">名称</Label>
            <Input
              id="keyname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：生产环境"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <Button
            onClick={createKey}
            disabled={creating || !name.trim()}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {creating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <PlusCircle className="mr-2 h-4 w-4" />
            )}
            创建 Key
          </Button>
        </CardContent>
      </Card>

      {/* Key 列表 */}
      <div className="space-y-4">
        {!keys?.length && <p className="text-muted-foreground">暂无 API Key</p>}
        {keys?.map((k) => (
          <Card key={k.id}>
            <CardContent className="py-4 flex items-center justify-between">
              <div>
                <p className="font-medium">{k.name}</p>
                <p className="text-sm text-muted-foreground font-mono">
                  {k.keyPrefix}…
                </p>
                <p className="text-xs text-muted-foreground">
                  创建于 {new Date(k.createdAt).toLocaleDateString()}
                  {k.lastUsedAt
                    ? ` · 最近使用 ${new Date(k.lastUsedAt).toLocaleString()}`
                    : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded-full text-xs ${
                    k.isActive
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {k.isActive ? '启用' : '已撤销'}
                </span>
                {k.isActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => revokeKey(k.id)}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
