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
import type { Provider, ProviderPreset } from '@/types';

const formSchema = z.object({
  name: z.string().min(1, '名称必填'),
  baseUrl: z
    .string()
    .min(1, 'Base URL 必填')
    .refine((v) => /^https?:\/\//.test(v), '必须以 http:// 或 https:// 开头'),
  apiKey: z.string(),
  model: z.string().min(1, '模型必填'),
  apiFormat: z.enum(['openai_chat', 'anthropic']),
});

type FormValues = z.infer<typeof formSchema>;

const BASE_URL_PLACEHOLDER: Record<FormValues['apiFormat'], string> = {
  openai_chat: '如 https://api.deepseek.com（自带版本段，无需自动补 /v1）',
  anthropic: '如 https://api.anthropic.com',
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
  onSave: (values: FormValues) => void;
  onCancel: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchModelError, setFetchModelError] = useState<string | null>(null);

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
    },
  });

  const apiFormat = watch('apiFormat');

  async function loadModels() {
    setFetchModelError(null);
    setFetchingModels(true);
    try {
      const list = await fetchModels({
        baseUrl: watch('baseUrl'),
        apiKey: watch('apiKey'),
        apiFormat,
      });
      if (list.length === 0) {
        setFetchModelError('接口返回空列表');
      } else {
        setModels(list.map((m) => m.id));
      }
    } catch (err) {
      setFetchModelError(`获取失败：${(err as Error).message}`);
    } finally {
      setFetchingModels(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSave)} className="flex flex-col gap-4">
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
          <Label htmlFor="model">模型</Label>
          <button
            type="button"
            onClick={loadModels}
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
