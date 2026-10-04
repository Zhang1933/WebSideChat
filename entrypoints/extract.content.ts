import { Readability } from '@mozilla/readability';
import type { ExtractResult } from '@/types';

/**
 * 正文提取脚本（按需注入，不常驻）。
 *
 * registration: 'runtime' → 不进 manifest，构建产物 /content-scripts/extract.js，
 * 由 Side Panel 通过 browser.scripting.executeScript({ files }) 显式注入，
 * main() 的返回值（必须 JSON 可序列化）经 results[0].result 回传。
 *
 * Readability.parse 内部会移除 script/style 等节点，textContent 即为纯文本，
 * 全程不使用 innerHTML，无需 DOMPurify。
 */
export default defineContentScript({
  registration: 'runtime',

  main(): ExtractResult {
    let text = '';
    let title = document.title ?? '';
    let byline: string | undefined;
    let siteName: string | undefined;
    let fallback = false;

    try {
      // 克隆离线 DOM，不影响页面本身
      const clone = document.cloneNode(true) as Document;
      const article = new Readability(clone).parse();
      if (article) {
        text = article.textContent ?? '';
        title = article.title || title;
        byline = article.byline || undefined;
        siteName = article.siteName || undefined;
      }
    } catch {
      // 极端页面解析异常 → 走兜底
    }

    // 兜底：非文章页 / 极简页面 / Readability 失败，退化为可见文本
    if (text.trim().length < 40) {
      fallback = true;
      text = document.body?.innerText ?? '';
    }

    return {
      title,
      byline,
      siteName,
      textContent: text,
      length: text.length,
      fallback,
    };
  },
});
