import { ChevronLeft, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { PROVIDER_PRESETS } from '@/config/presets';
import {
  currentProviderIdItem,
  deleteProvider,
  providersItem,
  saveProvider,
  saveSettings,
  settingsItem,
} from '@/lib/storage';
import type { AppSettings, Provider, ProviderPreset } from '@/types';
import { ProviderCard } from './ProviderCard';
import { PresetGrid } from './PresetGrid';
import { ProviderForm } from './ProviderForm';

type View = 'list' | 'preset' | 'form';

const EMPTY_CUSTOM_PRESET: ProviderPreset = PROVIDER_PRESETS.find((p) => p.id === 'custom')!;

/** 设置视图：供应商卡片列表 + 两步式新增 + 通用设置 */
export function ProvidersPage({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<View>('list');
  const [providers, setProviders] = useState<Record<string, Provider>>({});
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draftPreset, setDraftPreset] = useState<ProviderPreset>(EMPTY_CUSTOM_PRESET);
  const [editing, setEditing] = useState<Provider | null>(null);

  useEffect(() => {
    providersItem.getValue().then(setProviders);
    currentProviderIdItem.getValue().then(setCurrentId);
    settingsItem.getValue().then(setSettings);
    const unwatch1 = providersItem.watch(setProviders);
    const unwatch2 = currentProviderIdItem.watch(setCurrentId);
    return () => {
      unwatch1();
      unwatch2();
    };
  }, []);

  const list = Object.values(providers).sort((a, b) => a.createdAt - b.createdAt);

  function handleSave(values: {
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    apiFormat: 'openai_chat' | 'anthropic';
  }) {
    const provider: Provider = {
      id: editing?.id ?? crypto.randomUUID(),
      ...values,
      icon: editing?.icon ?? draftPreset.icon,
      iconColor: editing?.iconColor ?? draftPreset.iconColor,
      category: editing?.category ?? (draftPreset.id === 'custom' ? 'custom' : 'preset'),
      createdAt: editing?.createdAt ?? Date.now(),
    };
    saveProvider(provider);
    setView('list');
    setEditing(null);
  }

  function handleDelete(provider: Provider) {
    if (!confirm(`删除供应商「${provider.name}」？`)) return;
    deleteProvider(provider.id);
  }

  function patchSettings(patch: Partial<AppSettings>) {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    saveSettings(patch);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="icon-sm" aria-label="返回" onClick={onBack}>
          <ChevronLeft className="size-4" />
        </Button>
        <h1 className="text-sm font-semibold">
          {view === 'list' && '供应商设置'}
          {view === 'preset' && '选择预设'}
          {view === 'form' && (editing ? '编辑供应商' : `新增：${draftPreset.name}`)}
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        {view === 'list' && (
          <div className="flex flex-col gap-4">
            {list.length === 0 && (
              <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                还没有供应商，点击下方按钮添加
              </p>
            )}
            <div className="flex flex-col gap-2">
              {list.map((p) => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  isCurrent={p.id === currentId}
                  onUse={() => currentProviderIdItem.setValue(p.id)}
                  onEdit={() => {
                    setEditing(p);
                    setDraftPreset(EMPTY_CUSTOM_PRESET);
                    setView('form');
                  }}
                  onDelete={() => handleDelete(p)}
                />
              ))}
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null);
                setView('preset');
              }}
            >
              <Plus className="size-4" /> 新增供应商
            </Button>

            {settings && (
              <>
                <Separator className="my-2" />
                <div className="flex flex-col gap-3">
                  <h2 className="text-xs font-semibold text-muted-foreground">通用设置</h2>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="maxChars">正文提取上限（字符）</Label>
                    <Input
                      id="maxChars"
                      type="number"
                      min={8000}
                      max={200000}
                      step={1000}
                      defaultValue={settings.maxContentChars}
                      onBlur={(e) => {
                        const n = Math.min(200_000, Math.max(8000, Number(e.target.value) || 48_000));
                        e.target.value = String(n);
                        patchSettings({ maxContentChars: n });
                      }}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      超出部分将被截断（8,000 – 200,000，默认 48,000）
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>摘要语言</Label>
                    <Select
                      value={settings.summaryLanguage}
                      onValueChange={(v) => patchSettings({ summaryLanguage: v as AppSettings['summaryLanguage'] })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="zh">中文</SelectItem>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="auto">跟随页面语言</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {view === 'preset' && (
          <PresetGrid
            onSelect={(preset) => {
              setDraftPreset(preset);
              setEditing(null);
              setView('form');
            }}
          />
        )}

        {view === 'form' && (
          <ProviderForm
            preset={draftPreset}
            editing={editing}
            onSave={handleSave}
            onCancel={() => {
              setView(editing ? 'list' : 'preset');
              setEditing(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
