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

/** 等待 content script 的异步提取结果（YouTube 路径经 runtime.sendMessage 回传） */
function waitForAsyncExtract(tabId: number, timeoutMs = 30_000): Promise<ExtractResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new ExtractError('字幕提取超时，请重试'));
    }, timeoutMs);
    const listener = (msg: unknown, sender: { tab?: { id?: number } }) => {
      const m = msg as { type?: string; result?: ExtractResult } | null;
      if (!m || m.type !== 'webchat-extract-result') return;
      if (sender?.tab?.id !== tabId) return;
      cleanup();
      if (!m.result) {
        reject(new ExtractError('字幕提取结果无效'));
        return;
      }
      resolve(m.result);
    };
    function cleanup() {
      clearTimeout(timer);
      browser.runtime.onMessage.removeListener(listener);
    }
    browser.runtime.onMessage.addListener(listener);
  });
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
    const first = results[0]?.result as ExtractResult | { asyncPending?: boolean } | undefined;
    // YouTube 分支：注入不等待 Promise，改等消息回传
    if (first && typeof first === 'object' && (first as { asyncPending?: boolean }).asyncPending) {
      raw = await waitForAsyncExtract(tabId);
    } else {
      raw = first as ExtractResult | undefined;
    }
  } catch (err) {
    throw friendlyError(err);
  }

  if (!raw || typeof raw.textContent !== 'string') {
    throw new ExtractError('提取结果为空，请重试或换一个页面');
  }
  if (raw.error) {
    throw new ExtractError(raw.error);
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
