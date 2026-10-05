import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { CHARS_PER_TOKEN } from '@/lib/context';
import type { Provider } from '@/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 上下文上限的自动默认值（token；模型名无长度后缀时） */
export const AUTO_CONTEXT_LIMIT_TOKENS = 128_000;

export interface ContextSuffix {
  /** 上下文上限（token） */
  limit: number;
  /** 剥离后缀后的真实模型名 */
  baseModel: string;
}

const CONTEXT_SUFFIX_RE = /\[([\d.]+)([kKmM]?)\]\s*$/;

/**
 * 解析模型名尾部的上下文长度后缀（Claude Code 风格约定）：
 * "glm-5.3[1m]" → 1,000,000；"m[128k]" → 128,000；"[2000000]" → 2,000,000。
 * 方括号内容不是长度（如 "[beta]"）或数值过小（<1000）时视为模型名的一部分，返回 null。
 */
export function parseContextSuffix(model: string): ContextSuffix | null {
  const m = model.trim().match(CONTEXT_SUFFIX_RE);
  if (!m || m.index == null) return null;
  const num = Number(m[1]);
  if (!Number.isFinite(num) || num <= 0) return null;
  const unit = (m[2] ?? '').toLowerCase();
  const limit = unit === 'k' ? num * 1_000 : unit === 'm' ? num * 1_000_000 : num;
  if (limit < 1_000) return null;
  return { limit: Math.round(limit), baseModel: model.trim().slice(0, m.index).trim() };
}

/** 供应商的上下文上限（token）：显式配置优先，否则按模型名长度后缀推导 */
export function effectiveContextLimit(
  provider: Pick<Provider, 'model' | 'contextLimit'>,
): number {
  if (provider.contextLimit && provider.contextLimit > 0) {
    return provider.contextLimit;
  }
  return parseContextSuffix(provider.model)?.limit ?? AUTO_CONTEXT_LIMIT_TOKENS;
}

/**
 * 剥离模型名的上下文长度后缀（如 "glm-5.3[1m]" → "glm-5.3"）。
 * 后缀是声明上下文的标记，不是真实 API 模型 ID 的一部分，发送请求前必须去掉。
 */
export function stripContextSuffix(model: string): string {
  return parseContextSuffix(model)?.baseModel ?? model.trim();
}

/**
 * 正文提取预算（字符）：上下文 × 0.8 的 token 预算按 ~1.7 字符/token 折算成字符，
 * 预留 20% 给问答历史与输出（超限时由动态压缩兜底）。128k → 174,080 字符。
 */
export function contentBudgetChars(provider: Pick<Provider, 'model' | 'contextLimit'>): number {
  const budgetTokens = effectiveContextLimit(provider) * 0.8;
  const chars = Math.floor(budgetTokens * CHARS_PER_TOKEN);
  return Math.min(1_000_000, Math.max(4_000, chars));
}

/** 去掉 baseUrl 末尾斜杠 */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * 规范化 URL 作为会话键：去 hash、去 utm_* 等跟踪参数。
 * 解析失败时返回 trim 后的原文。
 */
export function pageKeyOf(url: string): string {
  const trimmed = url.trim();
  try {
    const u = new URL(trimmed);
    u.hash = '';
    const tracking = /^(utm_|spm|from|vd_source|ref$|ref_)/i;
    for (const key of [...u.searchParams.keys()]) {
      if (tracking.test(key)) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return trimmed;
  }
}

/** 按字符数截断正文，尾部加截断标记 */
export function truncateContent(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: text.slice(0, maxChars) + '\n\n[...内容过长，已截断，仅保留前 ' + maxChars.toLocaleString() + ' 字符...]',
    truncated: true,
  };
}

/**
 * 解析上下文上限输入的人类写法："1m" → 1,000,000，"128k" → 128,000，
 * "2000000" 原样返回；无法解析返回 null。
 */
export function parseContextInput(text: string): number | null {
  const m = text.trim().match(/^(\d+(?:\.\d+)?)([kKmM]?)$/);
  if (!m) return null;
  const num = Number(m[1]);
  if (!Number.isFinite(num) || num <= 0) return null;
  const unit = (m[2] ?? '').toLowerCase();
  return Math.round(unit === 'k' ? num * 1_000 : unit === 'm' ? num * 1_000_000 : num);
}
