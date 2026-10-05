import { normalizeBaseUrl } from '@/lib/utils';
import type { ApiFormat } from '@/types';

export interface FetchedModel {
  id: string;
  ownedBy: string | null;
}

/** ChatGPT Codex 后端内置的可用模型（对齐 Codex CLI 模型选择器） */
const CODEX_MODELS: FetchedModel[] = [
  { id: 'gpt-6.1-sol', ownedBy: 'openai' },
  { id: 'gpt-6-astra', ownedBy: 'openai' },
  { id: 'gpt-6-sol', ownedBy: 'openai' },
  { id: 'gpt-6-luna', ownedBy: 'openai' },
  { id: 'gpt-5.6-sol', ownedBy: 'openai' },
  { id: 'gpt-5.6-terra', ownedBy: 'openai' },
  { id: 'gpt-5.6-luna', ownedBy: 'openai' },
  { id: 'gpt-5.5', ownedBy: 'openai' },
];

/** 从服务商拉取模型列表（表单里"获取模型"按钮） */
export async function fetchModels(provider: {
  baseUrl: string;
  apiKey: string;
  apiFormat: ApiFormat;
  /** ChatGPT OAuth 时传入（Codex 后端无 /models 端点，直接返回内置列表） */
  accountId?: string;
}): Promise<FetchedModel[]> {
  const base = normalizeBaseUrl(provider.baseUrl);

  // ChatGPT Codex 后端没有公开的 /models 端点：返回内置列表（同 Codex CLI 行为）
  if (base.includes('chatgpt.com')) {
    return CODEX_MODELS;
  }

  const url = provider.apiFormat === 'anthropic' ? `${base}/v1/models` : `${base}/models`;
  const headers: Record<string, string> =
    provider.apiFormat === 'anthropic'
      ? { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${provider.apiKey}` };

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${text ? `：${text.slice(0, 200)}` : ''}`);
  }
  const json: any = await res.json();
  // OpenAI 标准格式 data[].id；智谱等兼容端点用 models[].slug
  const list: any[] = Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.models)
      ? json.models
      : [];
  return list
    .map((m) => ({
      id: String(m?.id ?? m?.slug ?? ''),
      ownedBy: m?.owned_by ?? m?.ownedBy ?? null,
    }))
    .filter((m) => m.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}
