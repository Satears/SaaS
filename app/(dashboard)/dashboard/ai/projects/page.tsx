'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Trash2, Loader2, FolderKanban } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type Project = {
  id: number;
  name: string;
  description: string | null;
  model: string;
  systemPrompt: string | null;
};

export default function ProjectsPage() {
  const { data: projects, mutate } = useSWR<Project[]>(
    '/api/ai/projects',
    fetcher
  );
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createProject() {
    if (!name.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, model, systemPrompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '创建失败');
      setName('');
      setDescription('');
      setSystemPrompt('');
      mutate();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function deleteProject(id: number) {
    if (!confirm('确认删除该项目？')) return;
    await fetch(`/api/ai/projects/${id}`, { method: 'DELETE' });
    mutate();
  }

  return (
    <section className="flex-1 p-4 lg:p-8">
      <h1 className="text-lg lg:text-2xl font-medium mb-6 flex items-center gap-2">
        <FolderKanban className="h-5 w-5 text-orange-500" />
        AI 项目
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 创建表单 */}
        <Card>
          <CardHeader>
            <CardTitle>新建项目</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">项目名称</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：客服助手"
              />
            </div>
            <div>
              <Label htmlFor="desc">描述</Label>
              <Input
                id="desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="项目用途说明"
              />
            </div>
            <div>
              <Label htmlFor="model">模型</Label>
              <select
                id="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4-turbo">gpt-4-turbo</option>
              </select>
            </div>
            <div>
              <Label htmlFor="sys">系统提示词（可选）</Label>
              <textarea
                id="sys"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={3}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="定义 AI 的角色与行为"
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <Button
              onClick={createProject}
              disabled={creating || !name.trim()}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              {creating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PlusCircle className="mr-2 h-4 w-4" />
              )}
              创建项目
            </Button>
          </CardContent>
        </Card>

        {/* 项目列表 */}
        <div className="space-y-4">
          {!projects?.length && (
            <p className="text-muted-foreground">暂无项目</p>
          )}
          {projects?.map((p) => (
            <Card key={p.id}>
              <CardContent className="py-4 flex items-start justify-between">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {p.model}
                    {p.description ? ` · ${p.description}` : ''}
                  </p>
                  {p.systemPrompt && (
                    <p className="text-xs text-muted-foreground mt-1 truncate max-w-[300px]">
                      提示词：{p.systemPrompt}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteProject(p.id)}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
