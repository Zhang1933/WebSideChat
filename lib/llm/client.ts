import type { ChatMessage, Provider } from '@/types';
import { anthropicAdapter } from './anthropic';
import { openaiChatAdapter } from './openai-chat';
import { SseParser } from './sse';
import type { LlmError, LlmStreamRequest, ProtocolAdapter, StreamHandlers } from './types';

export function adapterFor(provider: Provider): ProtocolAdapter {
  return provider.apiFormat === 'anthropic' ? anthropicAdapter : openaiChatAdapter;
}

function mapHttpError(status: number, body: string): LlmError {
  const excerpt = body.slice(0, 500);
  if (status === 401 || status === 403) {
    return { kind: 'auth', message: `鉴权失败（HTTP ${status}）：请检查 API Key 是否正确`, status };
  }
  if (status === 429) {
    return { kind: 'rate_limit', message: '请求过于频繁（HTTP 429）：请稍后重试', status };
  }
  if (status === 404) {
    return {
      kind: 'http',
      message: `接口不存在（HTTP 404）：请检查 Base URL 是否正确${excerpt ? `：${excerpt}` : ''}`,
      status,
    };
  }
  return { kind: 'http', message: `请求失败（HTTP ${status}）${excerpt ? `：${excerpt}` : ''}`, status };
}

/**
 * 流式对话。在 Side Panel 页面上下文直接调用（扩展页面对 host_permissions
 * 域可跨域），SSE 手动解析（EventSource 无法携带鉴权头）。
 */
export async function streamChat(
  provider: Provider,
  req: LlmStreamRequest,
  handlers: StreamHandlers,
): Promise<void> {
  const adapter = adapterFor(provider);
  const { url, headers, body } = adapter.buildRequest(provider, req);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: handlers.signal,
    });
  } catch (err) {
    if (isAbort(err)) {
      handlers.onError({ kind: 'aborted', message: '已停止生成' });
    } else {
      handlers.onError({
        kind: 'network',
        message: `网络错误：${(err as Error).message}。若连接本机 Ollama，请设置环境变量 OLLAMA_ORIGINS=chrome-extension://* 后重启 Ollama`,
      });
    }
    return;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    handlers.onError(mapHttpError(res.status, text));
    return;
  }

  const contentType = res.headers.get('content-type') ?? '';

  // 兜底：服务端忽略 stream:true，直接返回完整 JSON
  if (!contentType.includes('text/event-stream')) {
    try {
      const json = await res.json();
      const full = adapter.extractFull(json);
      if (full == null) {
        handlers.onError({ kind: 'parse', message: '无法从响应中提取文本' });
        return;
      }
      handlers.onDelta(full, full);
      handlers.onDone(full);
    } catch {
      handlers.onError({ kind: 'parse', message: '响应解析失败' });
    }
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  let full = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.feed(decoder.decode(value, { stream: true }))) {
        const r = adapter.extractDelta(ev);
        if (!r) continue;
        if (r.error) {
          handlers.onError(r.error);
          return;
        }
        if (r.text) {
          full += r.text;
          handlers.onDelta(full, r.text);
        }
        if (r.done) {
          handlers.onDone(full);
          return;
        }
      }
    }
    // 流关闭但未收到显式结束标记（flush 兜底最后一帧）
    for (const ev of parser.flush()) {
      const r = adapter.extractDelta(ev);
      if (r?.text) {
        full += r.text;
        handlers.onDelta(full, r.text);
      }
    }
    handlers.onDone(full);
  } catch (err) {
    if (isAbort(err)) {
      handlers.onError({ kind: 'aborted', message: '已停止生成' });
    } else {
      handlers.onError({ kind: 'network', message: `流式传输中断：${(err as Error).message}` });
    }
  }
}

/** 把 LlmError 翻译成用户可读文案（UI 直接展示） */
export function describeLlmError(err: LlmError): string {
  return err.message;
}

const COMPRESS_SYSTEM_PROMPT =
  '你是上下文压缩器。请把提供的对话历史压缩成一份简洁但信息完整的纪要，必须保留：' +
  '（1）此前摘要与回答中的关键事实、数据、结论；（2）用户提问的关注点与偏好；' +
  '（3）尚未解决的问题。直接输出纪要正文（Markdown），不要任何解释或客套。';

/**
 * 上下文动态压缩：调用模型把对话历史压缩为纪要。
 * 复用 streamChat（流式收集全文），失败抛出原始 LlmError 由调用方降级处理。
 */
export async function compressHistory(
  provider: Provider,
  history: ChatMessage[],
  signal: AbortSignal,
): Promise<string> {
  let acc = '';
  // 对象包装避免 TS 控制流把闭包内赋值的标志收窄为 null
  const failureRef: { err?: LlmError } = {};
  await streamChat(
    provider,
    { system: COMPRESS_SYSTEM_PROMPT, messages: history, maxTokens: 4096 },
    {
      onDelta: (full) => {
        acc = full;
      },
      onDone: (full) => {
        acc = full;
      },
      onError: (err) => {
        failureRef.err = err;
      },
      signal,
    },
  );
  if (failureRef.err) {
    throw new Error(`上下文压缩失败：${failureRef.err.message}`);
  }
  return acc;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}
