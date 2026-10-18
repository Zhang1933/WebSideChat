import { normalizeBaseUrl, stripContextSuffix } from '@/lib/utils';
import type { ExtractResult, ProtocolAdapter, SseEvent } from './types';

/**
 * Anthropic Messages 协议（也覆盖 Moonshot/Kimi 等提供的 Anthropic 兼容端点）。
 * 端点 POST {baseUrl}/v1/messages，流事件 content_block_delta / message_stop / error。
 */
export const anthropicAdapter: ProtocolAdapter = {
  buildRequest(provider, req) {
    return {
      url: `${normalizeBaseUrl(provider.baseUrl)}/v1/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
        // Claude Code 的 effort 参数需要此 beta 头（effort.md 文档）
        'anthropic-beta': 'effort-2025-11-24',
      },
      body: {
        model: stripContextSuffix(provider.model),
        system: req.system,
        messages: req.messages,
        // 摘要输出较长（视频摘要含大量时间戳链接），4096 会中途截断
        max_tokens: req.maxTokens ?? 16384,
        stream: true,
        // Claude Code 同款：output_config.effort 控制输出力度（low/medium/high），
        // 配合 anthropic-beta: effort-2025-11-24 头。GLM 等兼容端点部分模型始终
        // 思考、不支持 thinking.type=disabled（HTTP 1210），此参数是官方降档方式
        output_config: { effort: 'low' },
        ...(req.temperature != null ? { temperature: req.temperature } : {}),
      },
    };
  },

  extractDelta(ev: SseEvent): ExtractResult | null {
    if (ev.event === 'message_stop') return { text: '', done: true };
    if (ev.event === 'error') {
      let message = 'Anthropic 流式返回错误';
      try {
        const parsed = JSON.parse(ev.data);
        message = parsed?.error?.message || message;
      } catch {
        // data 非 JSON 时保留默认文案
      }
      return { error: { kind: 'provider', message } } as ExtractResult;
    }
    if (ev.event !== 'content_block_delta') return null;
    let json: any;
    try {
      json = JSON.parse(ev.data);
    } catch {
      return null;
    }
    const delta = json?.delta;
    // thinking 块的 thinking_delta 跳过，只取 text_delta
    if (delta?.type !== 'text_delta') return null;
    return { text: delta.text ?? '' };
  },

  extractFull(json) {
    const content = (json as any)?.content;
    if (!Array.isArray(content)) return null;
    const text = content
      .filter((block: any) => block?.type === 'text')
      .map((block: any) => block.text)
      .join('');
    return text || null;
  },
};
