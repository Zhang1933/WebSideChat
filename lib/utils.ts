import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
