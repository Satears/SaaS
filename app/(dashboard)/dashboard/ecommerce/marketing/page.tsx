'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Megaphone, Loader2, Copy, Sparkles } from 'lucide-react';

export default function MarketingPage() {
  const [campaignGoal, setCampaignGoal] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [channel, setChannel] = useState('');
  const [budget, setBudget] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!campaignGoal.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/ai/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scene: 'marketing',
          campaignGoal,
          targetAudience,
          channel,
          budget,
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
        <Megaphone className="h-6 w-6 text-purple-500" />
        AI营销策划
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">活动信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>活动目标 *</Label>
              <Input
                value={campaignGoal}
                onChange={(e) => setCampaignGoal(e.target.value)}
                placeholder="如：节日大促，目标到店客流提升 50%"
              />
            </div>
            <div>
              <Label>目标人群</Label>
              <Input
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                placeholder="如：25-35 岁都市女性"
              />
            </div>
            <div>
              <Label>投放渠道</Label>
              <Input
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                placeholder="如：抖音直播、小红书、私域社群"
              />
            </div>
            <div>
              <Label>预算</Label>
              <Input
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="如：5 万元"
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <Button
              onClick={generate}
              disabled={loading || !campaignGoal.trim()}
              className="w-full bg-purple-500 hover:bg-purple-600 text-white"
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              生成方案
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">策划方案</CardTitle>
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
                策划方案将显示在这里
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
