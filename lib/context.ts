import type { ChatMessage } from '@/types';

/**
 * Token 估算（近似）：中文约 1.7 字符/token，混合内容取保守值。
 * 不追求精确，只用于判断"是否接近上下文上限"。
 */
export const CHARS_PER_TOKEN = 1.7;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** 一轮请求的总 token 估算：system + 全部消息 */
export function estimateConversationTokens(system: string, messages: ChatMessage[]): number {
  let total = estimateTokens(system);
  for (const m of messages) total += estimateTokens(m.content) + 4; // 每条消息少量角色开销
  return total;
}

/**
 * 触发压缩/缩减的阈值：上下文 − 预留输出 − 安全余量。
 * 在逼近模型硬限制之前就把历史压掉，避免请求直接 400。
 */
export function compressThreshold(contextLimitTokens: number, maxOutputTokens = 4096): number {
  return contextLimitTokens - maxOutputTokens - 1024;
}
