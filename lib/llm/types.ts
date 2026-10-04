import type { ChatMessage, Provider } from '@/types';

export type { ChatMessage, Provider };

export interface LlmStreamRequest {
  system: string;
  messages: ChatMessage[];
  /** anthropic 协议必填，默认 4096 */
  maxTokens?: number;
  temperature?: number;
}

export type LlmErrorKind =
  | 'http'
  | 'network'
  | 'auth'
  | 'rate_limit'
  | 'parse'
  | 'aborted'
  | 'provider';

export interface LlmError {
  kind: LlmErrorKind;
  message: string;
  status?: number;
}

export interface StreamHandlers {
  /** 每次增量；fullText 为到目前为止的完整文本 */
  onDelta: (fullText: string, delta: string) => void;
  onDone: (fullText: string) => void;
  onError: (err: LlmError) => void;
  signal: AbortSignal;
}

/** 单个 SSE 事件解析结果 */
export interface SseEvent {
  event?: string;
  data: string;
}

/** 协议适配器从单个 SSE 事件提取的结果 */
export interface ExtractResult {
  text?: string;
  done?: boolean;
  error?: LlmError;
}

/** 协议适配器：把 Provider 配置翻译成具体 HTTP 请求并解析增量 */
export interface ProtocolAdapter {
  buildRequest(provider: Provider, req: LlmStreamRequest): { url: string; headers: Record<string, string>; body: unknown };
  /** 流式：从单个 SSE 事件提取增量 */
  extractDelta(ev: SseEvent): ExtractResult | null;
  /** 非流式兜底：服务端忽略 stream:true 返回整体 JSON 时提取完整文本 */
  extractFull(json: unknown): string | null;
}
