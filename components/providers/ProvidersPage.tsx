import { ChevronLeft, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
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

/** 供应商管理视图：卡片列表 + 两步式新增 + 通用设置（侧边栏与 options 整页共用） */
export function ProvidersPage({
  onBack,
  initialEditId,
  initialAdd,
}: {
  /** 提供时显示顶层返回按钮（侧边栏场景）；options 整页不需要 */
  onBack?: () => void;
  /** 深链：?edit=<providerId> 加载完成后自动进入该供应商的编辑表单 */
  initialEditId?: string | null;
  /** 深链：?add=1 自动进入新增预设网格 */
  initialAdd?: boolean;
}) {
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

  // 深链引导（只执行一次）：edit 需等 providers 加载后才能定位
  const bootstrappedRef = useRef(false);
  useEffect(() => {
    if (bootstrappedRef.current) return;
    if (initialEditId) {
      const target = providers[initialEditId];
      if (!target) return; // 等加载，或 id 不存在时留在列表
      bootstrappedRef.current = true;
      setEditing(target);
      setDraftPreset(EMPTY_CUSTOM_PRESET);
      setView('form');
    } else if (initialAdd) {
      bootstrappedRef.current = true;
      setView('preset');
    } else {
      bootstrappedRef.current = true;
    }
  }, [providers, initialEditId, initialAdd]);

  const list = Object.values(providers).sort((a, b) => a.createdAt - b.createdAt);

  function handleSave(
    values: {
      name: string;
      baseUrl: string;
      apiKey: string;
      model: string;
      apiFormat: 'openai_chat' | 'anthropic' | 'openai_responses';
      contextLimit: string;
    },
    extras: { accountId?: string },
  ) {
    const { contextLimit, ...rest } = values;
    const provider: Provider = {
      id: editing?.id ?? crypto.randomUUID(),
      ...rest,
      contextLimit: contextLimit ? Number(contextLimit) : undefined,
      // accountId 来自 auth.json 的 OAuth 导入，不在表单字段里
      accountId: extras.accountId,
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
        {view !== 'list' ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="返回"
            onClick={() => {
              // 表单页：编辑→列表，新增→预设页；预设页：→列表
              setView(view === 'form' && !editing ? 'preset' : 'list');
              setEditing(null);
            }}
          >
            <ChevronLeft className="size-4" />
          </Button>
        ) : onBack ? (
          <Button variant="ghost" size="icon-sm" aria-label="返回" onClick={onBack}>
            <ChevronLeft className="size-4" />
          </Button>
        ) : null}
        <h1 className="text-sm font-semibold">
          {view === 'list' && '供应商设置'}
          {view === 'preset' && '选择预设'}
          {view === 'form' && (editing ? `编辑：${editing.name}` : `新增：${draftPreset.name}`)}
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
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col">
                      <Label htmlFor="debug-mode">调试模式</Label>
                      <p className="text-[11px] text-muted-foreground">
                        顶栏"已提取 N 字符"变为可点击，查看实际送入模型的提取内容
                      </p>
                    </div>
                    <Switch
                      id="debug-mode"
                      checked={settings.debugMode ?? false}
                      onCheckedChange={(v) => patchSettings({ debugMode: v })}
                    />
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
