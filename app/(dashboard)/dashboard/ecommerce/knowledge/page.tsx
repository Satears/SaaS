'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BookOpen, PlusCircle, Trash2, Loader2, Search } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function KnowledgePage() {
  const { data: entries, mutate } = useSWR<any[]>('/api/ai/knowledge', fetcher);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [category, setCategory] = useState('');
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');

  async function addEntry() {
    if (!question.trim() || !answer.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/ai/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, answer, category: category || undefined }),
      });
      if (!res.ok) throw new Error('添加失败');
      setQuestion('');
      setAnswer('');
      setCategory('');
      mutate();
    } finally {
      setCreating(false);
    }
  }

  async function deleteEntry(id: number) {
    if (!confirm('确认删除该知识条目？')) return;
    await fetch(`/api/ai/knowledge/${id}`, { method: 'DELETE' });
    mutate();
  }

  const filtered = entries?.filter(
    (e) =>
      !search ||
      e.question.toLowerCase().includes(search.toLowerCase()) ||
      e.answer.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <section className="flex-1 p-4 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-medium mb-6 flex items-center gap-2">
        <BookOpen className="h-6 w-6 text-orange-500" />
        客服知识库
      </h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm">添加知识条目（FAQ）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>问题 *</Label>
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="如：支持无理由退货吗？"
            />
          </div>
          <div>
            <Label>答案 *</Label>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="填写标准答复，客服 AI 将优先参考"
              className="w-full border rounded-lg px-3 py-2 text-sm min-h-[100px]"
            />
          </div>
          <div>
            <Label>分类（可选）</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="如：物流 / 售后 / 产品"
            />
          </div>
          <Button
            onClick={addEntry}
            disabled={creating || !question.trim() || !answer.trim()}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {creating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <PlusCircle className="mr-2 h-4 w-4" />
            )}
            添加条目
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 mb-4">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索知识库…"
          className="max-w-sm"
        />
      </div>

      <div className="space-y-3">
        {!filtered?.length && (
          <p className="text-muted-foreground text-sm">暂无知识条目</p>
        )}
        {filtered?.map((e) => (
          <Card key={e.id}>
            <CardContent className="py-4 flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="font-medium text-sm">{e.question}</p>
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                  {e.answer}
                </p>
                {e.category && (
                  <span className="text-xs bg-muted px-2 py-0.5 rounded mt-2 inline-block">
                    {e.category}
                  </span>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => deleteEntry(e.id)}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
