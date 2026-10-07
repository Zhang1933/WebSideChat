import { isBilibiliVideoUrl } from '@/lib/bilibili';
import { ExtractError } from '@/lib/extractError';
import { t } from '@/lib/i18n';
import { truncateContent } from '@/lib/utils';
import { extractBilibiliFromPanel } from '@/lib/video/bilibili';
import { extractYouTubeFromPanel } from '@/lib/video/youtube';
import { isYouTubeWatchUrl } from '@/lib/youtube';
import type { Conversation, ExtractResult } from '@/types';

export { ExtractError };

/** 把 executeScript 的原始异常翻译成用户可读文案 */
function friendlyError(err: unknown): ExtractError {
  const msg = err instanceof Error ? err.message : String(err);
  if (/cannot access|cannot access contents of the page/i.test(msg)) {
    return new ExtractError(t('err.extract.noInjectPerm'));
  }
  if (/manifest.*permission|permission.*manifest/i.test(msg)) {
    return new ExtractError(t('err.extract.permHint'));
  }
  return new ExtractError(t('err.extract.fail', msg));
}

export interface ExtractSuccess {
  raw: ExtractResult;
  /** 截断后的正文 */
  content: string;
  truncated: boolean;
}

/** 注入提取脚本并截断正文（在 Side Panel 上下文调用）；视频站点分发到 lib/video/* 模块 */
export async function extractCurrentPage(
  tabId: number,
  maxChars: number,
  pageUrl?: string,
): Promise<ExtractSuccess> {
  let raw: ExtractResult | undefined;

  // YouTube / B 站：全程走扩展上下文，不注入 content script
  console.log('[WebSideChat extract] extractCurrentPage:', { pageUrl: pageUrl?.slice(0, 60) });
  if (pageUrl && isYouTubeWatchUrl(pageUrl)) {
    raw = await extractYouTubeFromPanel(tabId);
  } else if (pageUrl && isBilibiliVideoUrl(pageUrl)) {
    raw = await extractBilibiliFromPanel(tabId);
  } else {
    try {
      const results = await browser.scripting.executeScript({
        target: { tabId },
        files: ['/content-scripts/extract.js'],
      });
      raw = results[0]?.result as ExtractResult | undefined;
    } catch (err) {
      throw friendlyError(err);
    }
  }

  if (!raw || typeof raw.textContent !== 'string') {
    throw new ExtractError(t('err.extract.empty'));
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
