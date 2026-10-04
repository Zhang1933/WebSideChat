import { normalizeBaseUrl, stripContextSuffix } from '@/lib/utils';
import type { ExtractResult, ProtocolAdapter, SseEvent } from './types';

/**
 * OpenAI Responses API 协议（POST {baseUrl}/responses）。
 * Grok CLI / PackyAPI 等以 api_backend = "responses" 声明的端点使用此格式；
 * system 走顶层 instructions，消息走 input，流事件 response.output_text.delta。
 */
export const openaiResponsesAdapter: ProtocolAdapter = {
  buildRequest(provider, req) {
    return {
      url: `${normalizeBaseUrl(provider.baseUrl)}/responses`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
        // ChatGPT OAuth（access_token 鉴权）需要账号 ID 头
        ...(provider.accountId ? { 'chatgpt-account-id': provider.accountId } : {}),
      },
      body: {
        model: stripContextSuffix(provider.model),
        instructions: req.system,
        input: req.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        ...(req.maxTokens ? { max_output_tokens: req.maxTokens } : {}),
        ...(req.temperature != null ? { temperature: req.temperature } : {}),
      },
    };
  },

  extractDelta(ev: SseEvent): ExtractResult | null {
    let json: any;
    try {
      json = JSON.parse(ev.data);
    } catch {
      return null;
    }
    switch (json?.type) {
      case 'response.output_text.delta':
        return { text: typeof json.delta === 'string' ? json.delta : '' };
      case 'response.completed':
        return { text: '', done: true };
      case 'response.failed':
      case 'error': {
        const message =
          json?.error?.message ?? json?.response?.error?.message ?? 'Responses API 返回错误';
        return { error: { kind: 'provider', message } } as ExtractResult;
      }
      default:
        return null; // 其余事件（in_progress / output_item.added 等）忽略
    }
  },

  extractFull(json) {
    const output = (json as any)?.output;
    if (!Array.isArray(output)) return null;
    const text = output
      .filter((item: any) => item?.type === 'message')
      .flatMap((item: any) => (Array.isArray(item.content) ? item.content : []))
      .filter((block: any) => block?.type === 'output_text')
      .map((block: any) => block.text)
      .join('');
    return text || null;
  },
};
