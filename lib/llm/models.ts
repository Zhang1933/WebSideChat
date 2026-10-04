import { normalizeBaseUrl } from '@/lib/utils';
import type { ApiFormat } from '@/types';

export interface FetchedModel {
  id: string;
  ownedBy: string | null;
}

/** 从服务商拉取模型列表（表单里"获取模型"按钮） */
export async function fetchModels(provider: {
  baseUrl: string;
  apiKey: string;
  apiFormat: ApiFormat;
}): Promise<FetchedModel[]> {
  const base = normalizeBaseUrl(provider.baseUrl);
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
  const list: any[] = Array.isArray(json?.data) ? json.data : [];
  return list
    .map((m) => ({ id: String(m?.id ?? ''), ownedBy: m?.owned_by ?? m?.ownedBy ?? null }))
    .filter((m) => m.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}
