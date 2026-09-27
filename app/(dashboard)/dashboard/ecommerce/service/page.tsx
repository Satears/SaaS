'use client';

import { useState, useRef, useEffect } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Headphones, Loader2, Send, BookOpen, MessageSquare } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type ChatMsg = { role: 'user' | 'assistant'; content: string };

export default function ServicePage() {
  const { data: shops } = useSWR<any[]>('/api/ecommerce/shops', fetcher);
  const [shopId, setShopId] = useState<string>('');
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [knowledgeHits, setKnowledgeHits] = useState<any[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  async function send() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: userMsg }]);
    setLoading(true);
    try {
      const res = await fetch('/api/ai/service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          shopId: shopId ? Number(shopId) : null,
          message: userMsg,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '生成失败');
      setSessionId(data.sessionId);
      setMessages((m) => [...m, { role: 'assistant', content: data.content }]);
      setKnowledgeHits(data.knowledgeHits ?? []);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `[错误] ${e.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setSessionId(null);
    setMessages([]);
    setKnowledgeHits([]);
  }

  return (
    <section className="flex-1 p-4 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-medium flex items-center gap-2">
          <Headphones className="h-6 w-6 text-blue-500" />
          AI智能客服
        </h1>
        <Button variant="outline" size="sm" onClick={reset}>
          新会话
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card className="flex flex-col h-[600px]">
            <CardHeader className="border-b">
              <CardTitle className="text-sm flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                对话
              </CardTitle>
            </CardHeader>
            <CardContent
              ref={scrollRef}
              className="flex-1 overflow-y-auto space-y-4 py-4"
            >
              {messages.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-16">
                  开始与客户对话，AI 会自动关联知识库回答
                </p>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-lg px-4 py-2 text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在思考…
                  </div>
                </div>
              )}
            </CardContent>
            <div className="p-4 border-t">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                  placeholder="输入客户问题，回车发送"
                  className="flex-1 border rounded-lg px-3 py-2 text-sm"
                />
                <Button
                  onClick={send}
                  disabled={loading || !input.trim()}
                  className="bg-blue-500 hover:bg-blue-600 text-white"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">会话设置</CardTitle>
            </CardHeader>
            <CardContent>
              <Label>关联门店（用于知识库范围）</Label>
              <select
                value={shopId}
                onChange={(e) => setShopId(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                <option value="">全部门店</option>
                {shops?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                知识库命中
              </CardTitle>
            </CardHeader>
            <CardContent>
              {knowledgeHits.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  未命中知识库，AI 将基于通用客服知识回答
                </p>
              ) : (
                <div className="space-y-2">
                  {knowledgeHits.map((h) => (
                    <p key={h.id} className="text-xs bg-muted px-2 py-1 rounded">
                      {h.question}
                    </p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
