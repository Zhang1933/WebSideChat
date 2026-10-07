import { t } from '@/lib/i18n';
import type { ChatMessage, Provider } from '@/types';
import { anthropicAdapter } from './anthropic';
import { openaiChatAdapter } from './openai-chat';
import { openaiResponsesAdapter } from './responses';
import { SseParser } from './sse';
import type { LlmError, LlmStreamRequest, ProtocolAdapter, StreamHandlers } from './types';

export function adapterFor(provider: Provider): ProtocolAdapter {
  switch (provider.apiFormat) {
    case 'anthropic':
      return anthropicAdapter;
    case 'openai_responses':
      return openaiResponsesAdapter;
    default:
      return openaiChatAdapter;
  }
}

function mapHttpError(status: number, body: string): LlmError {
  const excerpt = body.slice(0, 500);
  if (status === 401 || status === 403) {
    return { kind: 'auth', message: t('err.llm.auth', status), status };
  }
  if (status === 429) {
    return { kind: 'rate_limit', message: t('err.llm.rateLimit'), status };
  }
  if (status === 404) {
    return {
      kind: 'http',
      message: t('err.llm.notFound', status, excerpt ? `：${excerpt}` : ''),
      status,
    };
  }
  return { kind: 'http', message: t('err.llm.http', status, excerpt ? `：${excerpt}` : ''), status };
}

/**
 * 流式对话。在扩展页面上下文直接调用（host_permissions 域可跨域），
 * SSE 手动解析（EventSource 无法携带鉴权头）。
 * 防御：服务端偶发返回 HTTP 200 但全程无内容（GLM 等兼容端点出现过）→
 * 明确报错提示用户手动重试，而不是静默生成一条看不见的空消息。
 */
export async function streamChat(
  provider: Provider,
  req: LlmStreamRequest,
  handlers: StreamHandlers,
): Promise<void> {
  const r = await streamOnce(provider, req, handlers);
  if (r.status === 'ok') {
    handlers.onDone(r.full);
  } else if (r.status === 'empty') {
    handlers.onError({
      kind: 'parse',
      message: t('err.llm.empty'),
    });
  }
  // 'handled'：错误/中止的终端回调已在 streamOnce 内发出
}

/** 单次流式请求；'empty'（200 但零内容）时不发终端回调，由上层决定重试 */
async function streamOnce(
  provider: Provider,
  req: LlmStreamRequest,
  handlers: StreamHandlers,
): Promise<{ status: 'ok'; full: string } | { status: 'empty' } | { status: 'handled' }> {
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
      handlers.onError({ kind: 'aborted', message: t('err.llm.stopped') });
    } else {
      handlers.onError({
        kind: 'network',
        message: t('err.llm.network', (err as Error).message),
      });
    }
    return { status: 'handled' };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    handlers.onError(mapHttpError(res.status, text));
    return { status: 'handled' };
  }

  const contentType = res.headers.get('content-type') ?? '';

  // ChatGPT Codex 后端不设 Content-Type 头：content-type 为空时按 SSE 处理
  // （我们请求了 stream:true，空 content-type 通常是服务端省略了头而非返回 JSON）
  const isSSE = contentType.includes('text/event-stream') || !contentType;

  // 兜底：服务端忽略 stream:true，直接返回完整 JSON
  if (!isSSE) {
    const rawBody = await res.text().catch(() => '');
    console.warn('[WebSideChat] 非 SSE 响应', {
      status: res.status,
      contentType,
      bodyPreview: rawBody.slice(0, 300),
    });
    try {
      const json = JSON.parse(rawBody);
      const full = adapter.extractFull(json);
      if (full == null) {
        handlers.onError({
          kind: 'parse',
          message: `无法从响应中提取文本（content-type: ${contentType}，body: ${rawBody.slice(0, 150)}）`,
        });
        return { status: 'handled' };
      }
      handlers.onDelta(full, full);
      return full.trim() ? { status: 'ok', full } : { status: 'empty' };
    } catch {
      handlers.onError({
        kind: 'parse',
        message: `响应解析失败（HTTP ${res.status}，content-type: ${contentType}，body: ${rawBody.slice(0, 150) || '(空)'}）`,
      });
      return { status: 'handled' };
    }
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  let full = '';
  /** 原始 SSE 事件采样（空流时输出，用于定位服务端行为） */
  const samples: string[] = [];

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.feed(decoder.decode(value, { stream: true }))) {
        if (samples.length < 10) samples.push(`${ev.event ?? 'message'}: ${ev.data.slice(0, 120)}`);
        const r = adapter.extractDelta(ev);
        if (!r) continue;
        if (r.error) {
          handlers.onError(r.error);
          return { status: 'handled' };
        }
        if (r.text) {
          full += r.text;
          handlers.onDelta(full, r.text);
        }
        if (r.done) {
          return full.trim() ? { status: 'ok', full } : { status: 'empty' };
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
    if (!full.trim()) {
      console.warn('[WebSideChat] 空流诊断', { status: res.status, contentType, samples });
      return { status: 'empty' };
    }
    return { status: 'ok', full };
  } catch (err) {
    if (isAbort(err)) {
      handlers.onError({ kind: 'aborted', message: t('err.llm.stopped') });
    } else {
      handlers.onError({ kind: 'network', message: t('err.llm.streamBroken', (err as Error).message) });
    }
    return { status: 'handled' };
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
