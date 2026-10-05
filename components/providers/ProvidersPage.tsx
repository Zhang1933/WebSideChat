import { ChevronLeft, Plus, ShieldAlert } from 'lucide-react';
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
import { getOriginPattern, hasHostPermission, requestHostPermissions } from '@/lib/permissions';
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

  // 老用户迁移：升级到按域授权后，已保存供应商的域名缺权限 → 横幅引导一键补授
  const [missingOrigins, setMissingOrigins] = useState<string[]>([]);
  useEffect(() => {
    if (Object.keys(providers).length === 0) {
      setMissingOrigins([]);
      return;
    }
    void (async () => {
      const patterns = [
        ...new Set(
          Object.values(providers)
            .map((p) => getOriginPattern(p.baseUrl))
            .filter((p): p is string => p != null),
        ),
      ];
      const missing: string[] = [];
      for (const pat of patterns) {
        if (!(await hasHostPermission(pat))) missing.push(pat);
      }
      setMissingOrigins(missing);
    })();
  }, [providers]);

  function handleSave(
    values: {
      name: string;
      baseUrl: string;
      apiKey: string;
      model: string;
      apiFormat: 'openai_chat' | 'anthropic' | 'openai_responses';
      contextLimit: string;
    },
    extras: { accountId?: string; importTexts?: Record<string, string> },
  ) {
    const { contextLimit, ...rest } = values;
    const provider: Provider = {
      id: editing?.id ?? crypto.randomUUID(),
      ...rest,
      contextLimit: contextLimit ? Number(contextLimit) : undefined,
      // accountId 来自 auth.json 的 OAuth 导入，不在表单字段里
      accountId: extras.accountId,
      // 记住新增时选择的配置类型：编辑时导入区保持相同的槽位（双框/单框）
      importHint: draftPreset.importHint,
      // 导入区配置原文（settings.json / auth.json / config.toml）随供应商保存，编辑时回显
      importTexts:
        extras.importTexts && Object.keys(extras.importTexts).length > 0
          ? extras.importTexts
          : undefined,
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
        {view === 'list' && missingOrigins.length > 0 && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="flex-1">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                {missingOrigins.length} 个供应商域名需要重新授权网络访问
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                升级为按域授权后，已有供应商需要补一次权限，否则对话请求无法发出
              </p>
              <Button
                size="sm"
                className="mt-2 h-7 bg-amber-600 hover:bg-amber-700"
                onClick={() =>
                  void requestHostPermissions(missingOrigins).then((ok) => {
                    if (ok) setMissingOrigins([]);
                  })
                }
              >
                一键授权
              </Button>
            </div>
          </div>
        )}
        {view === 'list' && (
          <div className="flex flex-col gap-4">
            {list.length === 0 ? (
              // 初始阶段：新增入口直接占据供应商卡片的位置，引导用户开始
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setView('preset');
                }}
                className="flex w-full items-center gap-3 rounded-lg border border-dashed p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent"
              >
                <div className="flex size-8 items-center justify-center rounded-md bg-secondary">
                  <Plus className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">新增供应商</p>
                  <p className="text-[11px] text-muted-foreground">
                    还没有供应商——选择 Claude Code / Codex / OpenCode，或粘贴配置文件导入
                  </p>
                </div>
              </button>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  {list.map((p) => (
                    <ProviderCard
                      key={p.id}
                      provider={p}
                      isCurrent={p.id === currentId}
                      onUse={() => currentProviderIdItem.setValue(p.id)}
                      onEdit={() => {
                        setEditing(p);
                        // 保留原配置类型的导入提示（编辑时导入区保持同样的槽位形状）
                        setDraftPreset(
                          p.importHint
                            ? { ...EMPTY_CUSTOM_PRESET, importHint: p.importHint }
                            : EMPTY_CUSTOM_PRESET,
                        );
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
              </>
            )}

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
                      <Label htmlFor="debug-mode">显示提取的 Web 内容</Label>
                      <p className="text-[11px] text-muted-foreground">
                        顶栏"已提取 N 字符"可点击，查看实际送入模型的提取内容
                      </p>
                    </div>
                    <Switch
                      id="debug-mode"
                      checked={settings.debugMode ?? true}
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
