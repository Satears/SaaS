'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PenLine, Loader2, Copy, Sparkles } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function CopywritingPage() {
  const { data: shops } = useSWR<any[]>('/api/ecommerce/shops', fetcher);
  const { data: products } = useSWR<any[]>(
    '/api/ecommerce/products',
    fetcher
  );
  const [productTitle, setProductTitle] = useState('');
  const [productInfo, setProductInfo] = useState('');
  const [keywords, setKeywords] = useState('');
  const [tone, setTone] = useState('');
  const [count, setCount] = useState(3);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!productTitle.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/ai/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scene: 'copywriting',
          productTitle,
          productInfo,
          keywords,
          tone,
          count,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '生成失败');
      setResult(data.content);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex-1 p-4 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-medium mb-6 flex items-center gap-2">
        <PenLine className="h-6 w-6 text-orange-500" />
        AI文案创作
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">输入商品信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>商品名称 *</Label>
              <Input
                value={productTitle}
                onChange={(e) => setProductTitle(e.target.value)}
                placeholder="如：无线蓝牙降噪耳机"
              />
            </div>
            <div>
              <Label>商品信息</Label>
              <textarea
                value={productInfo}
                onChange={(e) => setProductInfo(e.target.value)}
                rows={3}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="材质、功能、规格、适用人群等"
              />
            </div>
            <div>
              <Label>核心关键词</Label>
              <Input
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="如：降噪、长续航、舒适佩戴"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>文案风格</Label>
                <Input
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  placeholder="如：专业、年轻化"
                />
              </div>
              <div>
                <Label>生成条数</Label>
                <select
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  {[1, 2, 3, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} 条
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <Button
              onClick={generate}
              disabled={loading || !productTitle.trim()}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white"
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              生成文案
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">生成结果</CardTitle>
            {result && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigator.clipboard.writeText(result)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {result ? (
              <div className="whitespace-pre-wrap text-sm leading-relaxed bg-gray-50 rounded-lg p-4">
                {result}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                生成的文案将显示在这里
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
