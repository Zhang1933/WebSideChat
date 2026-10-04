import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
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
import { parseContextSuffix } from '@/lib/utils';
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
  // 留空 = 自动（模型名带 [1m] 后缀取 1,000,000，否则 128,000）
  contextLimit: z
    .string()
    .refine(
      (v) => v === '' || (Number.isFinite(Number(v)) && Number(v) >= 8_000 && Number(v) <= 10_000_000),
      '留空，或 8,000 – 10,000,000 之间的数字',
    ),
});

type FormValues = z.infer<typeof formSchema>;

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
  onSave: (values: FormValues, extras: { accountId?: string }) => void;
  onCancel: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchModelError, setFetchModelError] = useState<string | null>(null);
  // ChatGPT OAuth 的账号 ID 来自导入（不在表单字段里），编辑时保留、导入时覆盖
  const [accountId, setAccountId] = useState<string | undefined>(editing?.accountId);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
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
  const autoContextLimit = parseContextSuffix(model)?.limit ?? 128_000;

  async function loadModels(override?: {
    baseUrl?: string;
    apiKey?: string;
    apiFormat?: FormValues['apiFormat'];
  }): Promise<string[] | null> {
    setFetchModelError(null);
    setFetchingModels(true);
    try {
      const list = await fetchModels({
        baseUrl: override?.baseUrl ?? watch('baseUrl'),
        apiKey: override?.apiKey ?? watch('apiKey'),
        apiFormat: override?.apiFormat ?? watch('apiFormat'),
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
      onSubmit={handleSubmit((values) => onSave(values, { accountId }))}
      className="flex flex-col gap-4"
    >
      <ConfigImport
        hint={preset.importHint}
        onApply={async (draft) => {
          // OAuth 账号 ID 无条件覆盖：切回普通 Key 导入时清除
          setAccountId(draft.accountId);
          if (draft.apiFormat) setValue('apiFormat', draft.apiFormat);
          if (draft.baseUrl) setValue('baseUrl', draft.baseUrl);
          if (draft.apiKey) setValue('apiKey', draft.apiKey);
          if (draft.contextLimit) setValue('contextLimit', String(draft.contextLimit));
          if (draft.model) {
            // 长度后缀（如 [1m]/[128k]）是上下文标记而非真实模型 ID：
            // 提取数字写入上下文上限，模型名剥离后缀填入
            const parsed = parseContextSuffix(draft.model);
            if (parsed) {
              setValue('contextLimit', String(parsed.limit));
              setValue('model', parsed.baseModel);
            } else {
              setValue('model', draft.model);
            }
          }
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
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="baseUrl">Base URL</Label>
        <Input id="baseUrl" placeholder={BASE_URL_PLACEHOLDER[apiFormat]} {...register('baseUrl')} />
        {errors.baseUrl && <p className="text-xs text-destructive">{errors.baseUrl.message}</p>}
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
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="model">模型选择</Label>
          <button
            type="button"
            onClick={() => void loadModels()}
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
        {fetchModelError && <p className="text-xs text-muted-foreground">{fetchModelError}</p>}
        {errors.model && <p className="text-xs text-destructive">{errors.model.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contextLimit">上下文上限（token）</Label>
        <Input
          id="contextLimit"
          type="number"
          placeholder={`自动：${autoContextLimit.toLocaleString()}`}
          {...register('contextLimit')}
        />
        <p className="text-[11px] text-muted-foreground">
          留空 = 自动：模型名带长度后缀（如 [1m]、[128k]）自动取对应 token 数，否则 128,000
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
