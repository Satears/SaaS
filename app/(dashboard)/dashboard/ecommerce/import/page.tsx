'use client';

import { useState, useRef } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Package, Upload, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type ImportResult = {
  success: boolean;
  total: number;
  inserted: number;
  errors: { row: number; message: string }[];
};

export default function ProductImportPage() {
  const { data: shops } = useSWR<any[]>('/api/ecommerce/shops', fetcher);
  const [shopId, setShopId] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function downloadTemplate() {
    const res = await fetch('/api/ecommerce/products/import');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'products-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doImport() {
    if (!shopId || !file || importing) return;
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append('shopId', shopId);
      form.append('file', file);
      const res = await fetch('/api/ecommerce/products/import', {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '导入失败');
      setResult(data);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e: any) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="flex-1 p-4 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-medium mb-6 flex items-center gap-2">
        <Package className="h-6 w-6 text-orange-500" />
        商品批量导入
      </h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm flex items-center justify-between">
            <span>上传 CSV 文件</span>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="mr-2 h-4 w-4" />
              下载模板
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>目标门店 *</Label>
            <select
              value={shopId}
              onChange={(e) => setShopId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">请选择门店</option>
              {shops?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label>CSV 文件 *</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              支持列：title（标题，必填）、description、category、price、sku，以及 color/size/material 等自定义属性列。
            </p>
          </div>

          {error && (
            <p className="text-red-500 text-sm flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              {error}
            </p>
          )}

          <Button
            onClick={doImport}
            disabled={importing || !shopId || !file}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {importing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            开始导入
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">导入结果</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              成功导入 {result.inserted} / {result.total} 条商品
            </p>
            {result.errors.length > 0 && (
              <div className="text-sm text-red-500">
                <p className="font-medium">跳过 {result.errors.length} 条（含错误）：</p>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  {result.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>
                      第 {e.row} 行：{e.message}
                    </li>
                  ))}
                  {result.errors.length > 10 && (
                    <li>…其余 {result.errors.length - 10} 条</li>
                  )}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
