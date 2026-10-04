import { normalizeBaseUrl, stripContextSuffix } from '@/lib/utils';
import type { ExtractResult, ProtocolAdapter, SseEvent } from './types';

/**
 * OpenAI Chat Completions 协议（兼容 DeepSeek/Kimi/Qwen/Ollama/OneAPI 等）。
 * 端点 POST {baseUrl}/chat/completions，流结束标记 data: [DONE]。
 */
export const openaiChatAdapter: ProtocolAdapter = {
  buildRequest(provider, req) {
    return {
      url: `${normalizeBaseUrl(provider.baseUrl)}/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: {
        model: stripContextSuffix(provider.model),
        messages: [{ role: 'system', content: req.system }, ...req.messages],
        stream: true,
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
        ...(req.temperature != null ? { temperature: req.temperature } : {}),
      },
    };
  },

  extractDelta(ev: SseEvent): ExtractResult | null {
    if (ev.data === '[DONE]') return { text: '', done: true };
    let json: any;
    try {
      json = JSON.parse(ev.data);
    } catch {
      return null; // 忽略无法解析的帧（部分服务商会夹心跳/非 JSON 行）
    }
    const choice = json?.choices?.[0];
    if (!choice) return null;
    const text: string | undefined = choice.delta?.content;
    // DeepSeek R1 等 reasoning 模型的思维链增量：跳过，只取正文
    return {
      text: text ?? '',
      done: choice.finish_reason != null,
    };
  },

  extractFull(json) {
    const content = (json as any)?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : null;
  },
};
