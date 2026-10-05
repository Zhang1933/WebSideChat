import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
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
import { fetchModels } from '@/lib/llm/models';
import { loginCodexOAuth } from '@/lib/oauth';
import { cleanCodexToml, parseAndMergeTexts, syncDraftToTexts, type ProviderDraft } from '@/lib/importConfig';
import { parseContextInput, parseContextSuffix } from '@/lib/utils';
import type { Provider, ProviderPreset } from '@/types';
import { ConfigImport } from './ConfigImport';

const formSchema = z.object({
  name: z.string().min(1, '名称必填'),
  baseUrl: z
    .string()
    .min(1, 'Base URL 必填')
    .refine((v) => /^https?:\/\//.test(v), '必须以 http:// 或 https:// 开头'),
  apiKey: z.string(),
  model: z.string().min(1, '模型必填'),
  apiFormat: z.enum(['openai_chat', 'anthropic', 'openai_responses']),
  // 留空 = 自动（模型名带 [1m] 后缀取 1,000,000，否则 1,000,000）
  contextLimit: z
    .string()
    .refine(
      (v) => v === '' || (Number.isFinite(Number(v)) && Number(v) >= 8_000 && Number(v) <= 10_000_000),
      '留空，或 8,000 – 10,000,000 之间的数字',
    ),
});

type FormValues = z.infer<typeof formSchema>;

/**
 * 编辑时回填导入区：优先用保存过的配置原文；旧数据（功能上线前保存的供应商）
 * 没有原文时，按当前字段值反向生成等效配置，保证导入区不为空。
 */
function backfillImportTexts(editing: Provider | null): Record<string, string> {
  if (!editing) return {};
  if (editing.importTexts && Object.keys(editing.importTexts).length > 0) {
    return editing.importTexts;
  }
  if (editing.apiFormat === 'anthropic') {
    // Claude：合成 settings.json
    return {
      main: JSON.stringify(
        {
          env: {
            ANTHROPIC_BASE_URL: editing.baseUrl,
            ANTHROPIC_AUTH_TOKEN: editing.apiKey,
            ANTHROPIC_MODEL: editing.model,
          },
        },
        null,
        2,
      ),
    };
  }
  if (editing.importHint === 'codex' || editing.accountId) {
    // OpenAI/Codex：合成 auth.json + config.toml
    const auth = editing.accountId
      ? {
          auth_mode: 'chatgpt',
          OPENAI_API_KEY: null,
          tokens: { access_token: editing.apiKey, account_id: editing.accountId },
        }
      : { auth_mode: 'apikey', OPENAI_API_KEY: editing.apiKey };
    return {
      auth: JSON.stringify(auth, null, 2),
      toml: [
        `model = "${editing.model}"`,
        '',
        '[model_providers.openai]',
        'name = "OpenAI"',
        `base_url = "${editing.baseUrl}"`,
        `wire_api = "${editing.apiFormat === 'openai_responses' ? 'responses' : 'chat'}"`,
      ].join('\n'),
    };
  }
  return {};
}

/** OAuth 登录成功后预填的默认 config.toml（指向 ChatGPT Codex 后端，可编辑后重新解析） */
const DEFAULT_CODEX_CONFIG_TOML = [
  'model = "gpt-6-luna"',
  'model_provider = "openai"',
  'model_reasoning_effort = "medium"',
  '',
  '[model_providers.openai]',
  'name = "OpenAI (ChatGPT 登录)"',
  'base_url = "https://chatgpt.com/backend-api/codex"',
  'wire_api = "responses"',
].join('\n');

const BASE_URL_PLACEHOLDER: Record<FormValues['apiFormat'], string> = {
  openai_chat: '如 https://api.deepseek.com（自带版本段，无需自动补 /v1）',
  anthropic: '如 https://api.anthropic.com',
  openai_responses: '如 https://api.x.ai/v1',
};

export function ProviderForm({
  preset,
  editing,
  onSave,
  onCancel,
}: {
  /** 新增时来自预设；编辑时由现有 provider 生成 */
  preset: ProviderPreset;
  /** 编辑中的供应商（有 id）；新增为 null */
  editing: Provider | null;
  onSave: (values: FormValues, extras: { accountId?: string; importTexts?: Record<string, string> }) => void;
  onCancel: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchModelError, setFetchModelError] = useState<string | null>(null);
  // ChatGPT OAuth 的账号 ID 来自导入（不在表单字段里），编辑时保留、导入时覆盖
  const [accountId, setAccountId] = useState<string | undefined>(editing?.accountId);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthMsg, setOauthMsg] = useState<string | null>(null);
  /** OAuth 登录成功后生成的配置内容，预填到导入区输入框 */
  const [importPrefill, setImportPrefill] = useState<Record<string, string> | undefined>();
  /** 导入区各输入框内容（受控；编辑时回显保存过的原文，旧数据反向生成等效配置） */
  const [importTexts, setImportTexts] = useState<Record<string, string>>(() =>
    backfillImportTexts(editing),
  );

  useEffect(() => {
    if (!importPrefill) return;
    setImportTexts((prev) => ({ ...prev, ...importPrefill }));
  }, [importPrefill]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: editing?.name ?? preset.name,
      baseUrl: editing?.baseUrl ?? preset.baseUrl,
      apiKey: editing?.apiKey ?? '',
      model: editing?.model ?? preset.defaultModel,
      apiFormat: editing?.apiFormat ?? preset.apiFormat,
      contextLimit: editing?.contextLimit != null ? String(editing.contextLimit) : '',
    },
  });

  const apiFormat = watch('apiFormat');
  const model = watch('model');
  const autoContextLimit = parseContextSuffix(model)?.limit ?? 1_000_000;

  // 双向同步（form → 配置文本）：表单字段变化时把值写回 JSON/TOML；
  // 由 ConfigImport 失焦时反向应用（文本 → 表单），写回相同值时引用不变，无循环
  useEffect(() => {
    const sub = watch((values) => {
      setImportTexts((prev) =>
        syncDraftToTexts(prev, preset.importHint, {
          baseUrl: values.baseUrl,
          apiKey: values.apiKey,
          model: values.model,
        }),
      );
    });
    return () => sub.unsubscribe();
  }, [watch, preset.importHint]);

  /** ChatGPT 网页登录（同 codex login 的 PKCE 流程）：成功后生成 auth.json + 默认
   *  config.toml 预填到导入区，并直接填入表单字段 */
  async function handleCodexLogin() {
    setOauthBusy(true);
    setOauthMsg(null);
    try {
      const result = await loginCodexOAuth();
      setValue('apiFormat', 'openai_responses');
      setValue('baseUrl', 'https://chatgpt.com/backend-api/codex');
      setValue('apiKey', result.access_token);
      setValue('model', 'gpt-6-luna');
      setAccountId(result.account_id);
      // 生成等效 auth.json + 默认 config.toml，预填导入区（可见、可改、可重新解析）
      const authJson = JSON.stringify(
        {
          auth_mode: 'chatgpt',
          OPENAI_API_KEY: null,
          tokens: {
            id_token: result.id_token,
            access_token: result.access_token,
            refresh_token: result.refresh_token,
            account_id: result.account_id,
          },
          last_refresh: new Date().toISOString(),
        },
        null,
        2,
      );
      setImportPrefill({ auth: authJson, toml: DEFAULT_CODEX_CONFIG_TOML });
      setOauthMsg(
        `登录成功${result.account_id ? `（账号 ${result.account_id.slice(0, 8)}…）` : ''}，已生成 auth.json 与默认 config.toml`,
      );
    } catch (err) {
      setOauthMsg(`登录失败：${(err as Error).message}`);
    } finally {
      setOauthBusy(false);
    }
  }

  /** 把解析出的配置草稿应用到表单字段（解析填充与提交前自动解析共用） */
  function applyDraftToForm(draft: ProviderDraft) {
    // 仅在草稿带有 accountId 时才设置：config.toml/空模板解析不含此字段，
    // 不应覆盖 OAuth 登录已设置的值（这是 accountId 丢失的根因）
    if (draft.accountId) setAccountId(draft.accountId);
    if (draft.apiFormat) setValue('apiFormat', draft.apiFormat);
    if (draft.baseUrl) setValue('baseUrl', draft.baseUrl);
    if (draft.apiKey) setValue('apiKey', draft.apiKey);
    if (draft.contextLimit) setValue('contextLimit', String(draft.contextLimit));
    if (draft.model) {
      // 长度后缀（如 [1m]/[128k]）提取数字入上下文上限，模型名剥离后缀
      const parsed = parseContextSuffix(draft.model);
      if (parsed) {
        setValue('contextLimit', String(parsed.limit));
        setValue('model', parsed.baseModel);
      } else {
        setValue('model', draft.model);
      }
    }
  }

  async function loadModels(override?: {
    baseUrl?: string;
    apiKey?: string;
    apiFormat?: FormValues['apiFormat'];
    accountId?: string;
  }): Promise<string[] | null> {
    setFetchModelError(null);
    setFetchingModels(true);
    try {
      const list = await fetchModels({
        baseUrl: override?.baseUrl ?? watch('baseUrl'),
        apiKey: override?.apiKey ?? watch('apiKey'),
        apiFormat: override?.apiFormat ?? watch('apiFormat'),
        accountId: override?.accountId ?? accountId,
      });
      if (list.length === 0) {
        setFetchModelError('接口返回空列表');
        return null;
      }
      const ids = list.map((m) => m.id);
      setModels(ids);
      return ids;
    } catch (err) {
      setFetchModelError(`获取失败：${(err as Error).message}`);
      return null;
    } finally {
      setFetchingModels(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        // 兜底：粘贴后未失焦直接提交时自动解析应用（正常路径是失焦即解析），
        // 之后唯一强制校验的是没有默认值的 API Key
        const { draft } = parseAndMergeTexts(
          Object.entries(importTexts).map(([key, text]) => ({ key, text })),
        );
        if (draft.apiKey || draft.baseUrl || draft.model || draft.apiFormat || draft.contextLimit) {
          applyDraftToForm(draft);
        }
        // 上下文上限的人类写法兜底转换（未触发 onBlur 就提交的场景）
        const rawLimit = getValues('contextLimit');
        if (rawLimit) {
          const n = parseContextInput(rawLimit);
          if (n != null) setValue('contextLimit', String(n));
        }
        void handleSubmit((values) => {
          if (!getValues('apiKey').trim()) {
            setError('apiKey', {
              type: 'manual',
              message: 'API Key 不能为空：粘贴配置文件（失焦自动填充），或手动填写',
            });
            return;
          }
          // 保存的 config.toml 去掉 projects/plugins 等本机噪音，只留关键配置
          const cleanedTexts = { ...importTexts };
          if (cleanedTexts.toml) cleanedTexts.toml = cleanCodexToml(cleanedTexts.toml);
          onSave(values, { accountId, importTexts: cleanedTexts });
        })(e);
      }}
      className="flex flex-col gap-4"
    >
      {preset.importHint === 'codex' && (
        <div className="flex items-center gap-3 rounded-lg border border-dashed p-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">ChatGPT 账号登录（OAuth）</p>
            <p className="text-[11px] text-muted-foreground">
              跳转网页授权，成功后自动生成 auth.json 与默认 config.toml
            </p>
            {oauthMsg && (
              <p
                className={
                  oauthMsg.startsWith('登录成功')
                    ? 'text-[11px] text-primary'
                    : 'text-[11px] text-destructive'
                }
              >
                {oauthMsg}
              </p>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={oauthBusy}
            onClick={() => void handleCodexLogin()}
          >
            {oauthBusy ? '等待登录…' : '网页登录'}
          </Button>
        </div>
      )}

      <ConfigImport
        hint={preset.importHint}
        texts={importTexts}
        onTextsChange={setImportTexts}
        onApply={async (draft) => {
          applyDraftToForm(draft);
          // 导入后自动拉取模型列表；配置文件没带模型时默认选第一个
          const ids = await loadModels({
            baseUrl: draft.baseUrl,
            apiKey: draft.apiKey,
            apiFormat: draft.apiFormat,
          });
          if (ids && !draft.model) setValue('model', ids[0]!);
        }}
      />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">名称</Label>
        <Input id="name" placeholder="供应商显示名" {...register('name')} />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>接口协议</Label>
        {preset.importHint === 'claude-settings' ? (
          // Claude Code 固定走 Anthropic Messages 协议，不可更改
          <div className="flex h-9 items-center rounded-md border bg-muted/50 px-3 text-sm text-muted-foreground">
            Anthropic（v1/messages）
          </div>
        ) : preset.importHint === 'codex' ? (
          // Codex 固定走 OpenAI Responses 协议，不可更改
          <div className="flex h-9 items-center rounded-md border bg-muted/50 px-3 text-sm text-muted-foreground">
            OpenAI Responses（v1/responses）
          </div>
        ) : (
          <Select value={apiFormat} onValueChange={(v) => setValue('apiFormat', v as FormValues['apiFormat'])}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai_chat">OpenAI 兼容（chat/completions）</SelectItem>
              <SelectItem value="anthropic">Anthropic（v1/messages）</SelectItem>
              <SelectItem value="openai_responses">OpenAI Responses（v1/responses）</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="apiKey">API Key</Label>
        <div className="relative">
          <Input
            id="apiKey"
            type={showKey ? 'text' : 'password'}
            autoComplete="off"
            placeholder="sk-…（Ollama 等本机服务可留空）"
            className="pr-9"
            {...register('apiKey')}
          />
          <button
            type="button"
            aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
            onClick={() => setShowKey((v) => !v)}
            className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {errors.apiKey && <p className="text-xs text-destructive">{errors.apiKey.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="baseUrl">Base URL</Label>
        <Input id="baseUrl" placeholder={BASE_URL_PLACEHOLDER[apiFormat]} {...register('baseUrl')} />
        {errors.baseUrl && <p className="text-xs text-destructive">{errors.baseUrl.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="model">模型选择</Label>
          <button
            type="button"
            onClick={() =>
              void loadModels().then((ids) => {
                // 手动填写场景：当前模型为空或预设默认值不在列表中 → 自动选中第一个
                if (ids && !ids.includes(watch('model'))) setValue('model', ids[0]!);
              })
            }
            disabled={fetchingModels}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {fetchingModels ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            {fetchingModels ? '获取中…' : '获取模型列表'}
          </button>
        </div>
        {models ? (
          <div className="flex items-center gap-2">
            <Select value={watch('model')} onValueChange={(v) => setValue('model', v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {/* 配置文件带入的模型可能不在 /models 列表里，固定置顶防止下拉显示为空 */}
                {watch('model') && !models.includes(watch('model')) && (
                  <SelectItem value={watch('model')}>{watch('model')}（配置值）</SelectItem>
                )}
                {models.map((id) => (
                  <SelectItem key={id} value={id}>
                    {id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="sm" onClick={() => setModels(null)}>
              手动输入
            </Button>
          </div>
        ) : (
          <Input id="model" placeholder="模型 ID" {...register('model')} />
        )}
        {fetchModelError && <p className="text-xs text-destructive">{fetchModelError}</p>}
        {errors.model && <p className="text-xs text-destructive">{errors.model.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contextLimit">上下文上限（token）</Label>
        <Input
          id="contextLimit"
          type="text"
          placeholder={`自动：${autoContextLimit.toLocaleString()}`}
          {...register('contextLimit')}
          onBlur={(e) => {
            // 人类写法自动转数字："1m" → 1000000，"128k" → 128000
            const n = parseContextInput(e.target.value);
            if (n != null) {
              e.target.value = String(n);
              setValue('contextLimit', String(n), { shouldValidate: true });
            }
          }}
        />
        <p className="text-[11px] text-muted-foreground">
          留空 = 自动：模型名带长度后缀（如 [1m]、[128k]）自动取对应 token 数，否则 1,000,000；也可直接填 1m、128k
        </p>
        {errors.contextLimit && (
          <p className="text-xs text-destructive">{errors.contextLimit.message}</p>
        )}
      </div>

      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" size="sm">
          保存
        </Button>
      </div>
    </form>
  );
}
