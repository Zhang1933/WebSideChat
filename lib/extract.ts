import { truncateContent } from '@/lib/utils';
import type { Conversation, ExtractResult } from '@/types';

export class ExtractError extends Error {}

/** 把 executeScript 的原始异常翻译成用户可读文案 */
function friendlyError(err: unknown): ExtractError {
  const msg = err instanceof Error ? err.message : String(err);
  if (/cannot access|cannot access contents of the page/i.test(msg)) {
    return new ExtractError('此页面类型不支持提取（浏览器内置页面 / 商店页 / PDF 查看器）');
  }
  if (/manifest.*permission|permission.*manifest/i.test(msg)) {
    return new ExtractError('没有注入权限，请在扩展详情页确认已授予网站访问权限');
  }
  return new ExtractError(`页面提取失败：${msg}`);
}

export interface ExtractSuccess {
  raw: ExtractResult;
  /** 截断后的正文 */
  content: string;
  truncated: boolean;
}

/** 注入提取脚本并截断正文（在 Side Panel 上下文调用） */
export async function extractCurrentPage(
  tabId: number,
  maxChars: number,
): Promise<ExtractSuccess> {
  let raw: ExtractResult | undefined;
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/extract.js'],
    });
    raw = results[0]?.result as ExtractResult | undefined;
  } catch (err) {
    throw friendlyError(err);
  }

  if (!raw || typeof raw.textContent !== 'string') {
    throw new ExtractError('提取结果为空，请重试或换一个页面');
  }
  const { text, truncated } = truncateContent(raw.textContent, maxChars);
  return { raw, content: text, truncated };
}

/** 由提取结果生成新会话 */
export function conversationFromExtract(params: {
  pageKey: string;
  url: string;
  extract: ExtractSuccess;
}): Conversation {
  const now = Date.now();
  return {
    pageKey: params.pageKey,
    url: params.url,
    title: params.extract.raw.title || params.url,
    content: params.extract.content,
    truncated: params.extract.truncated,
    extractedAt: now,
    messages: [],
    updatedAt: now,
  };
}
