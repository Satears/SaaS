'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Sparkles, Send, Loader2 } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type Message = { role: 'user' | 'assistant'; content: string };
type Project = { id: number; name: string; model: string };

export default function AiChatPage() {
  const { data: projects } = useSWR<Project[]>('/api/ai/projects', fetcher);
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const content = input.trim();
    if (!content || loading) return;

    const nextMessages: Message[] = [
      ...messages,
      { role: 'user', content },
    ];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProject,
          messages: nextMessages,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '请求失败');
      }

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.content },
      ]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex-1 p-4 lg:p-8 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg lg:text-2xl font-medium flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-orange-500" />
          AI 助手
        </h1>
        <select
          value={selectedProject ?? ''}
          onChange={(e) =>
            setSelectedProject(e.target.value ? Number(e.target.value) : null)
          }
          className="border rounded-lg px-3 py-2 text-sm bg-background"
        >
          <option value="">默认（无项目）</option>
          {projects?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}（{p.model}）
            </option>
          ))}
        </select>
      </div>

      <Card className="flex-1 flex flex-col">
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground py-16">
              <Sparkles className="h-8 w-8 mx-auto mb-2 text-orange-400" />
              <p>开始与 AI 对话，或创建一个项目来定制模型与系统提示词</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-100 text-gray-900'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-2xl px-4 py-2 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">思考中…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </CardContent>
      </Card>

      {error && <p className="text-red-500 text-sm mt-2">{error}</p>}

      <div className="flex gap-2 mt-4">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="输入消息，回车发送…"
          disabled={loading}
          className="flex-1"
        />
        <Button
          onClick={send}
          disabled={loading || !input.trim()}
          className="bg-orange-500 hover:bg-orange-600 text-white"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}
