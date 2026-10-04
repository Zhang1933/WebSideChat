import { Readability } from '@mozilla/readability';
import { convertHtmlToMarkdown } from '@/lib/markdown';
import type { ExtractResult } from '@/types';

/**
 * 正文提取脚本（按需注入，不常驻）。
 *
 * registration: 'runtime' → 不进 manifest，构建产物 /content-scripts/extract.js，
 * 由 Side Panel 通过 browser.scripting.executeScript({ files }) 显式注入，
 * main() 的返回值（必须 JSON 可序列化）经 results[0].result 回传。
 *
 * 三级提取策略（DOM → Markdown，保留标题/列表/表格/链接结构）：
 * ① Readability 定位正文容器，其 article.content（已净化的 HTML）转 Markdown
 * ② 非文章页：整页克隆剔除 script/style 等噪声节点后转 Markdown
 * ③ 最终兜底：document.body.innerText 纯文本
 */
export default defineContentScript({
  registration: 'runtime',

  main(): ExtractResult {
    let markdown = '';
    let title = document.title ?? '';
    let byline: string | undefined;
    let siteName: string | undefined;
    let fallback = false;

    let article: ReturnType<Readability['parse']> = null;
    try {
      // 克隆离线 DOM，不影响页面本身
      const clone = document.cloneNode(true) as Document;
      article = new Readability(clone).parse();
    } catch {
      // 极端页面解析异常 → 走兜底
    }

    // ① Readability 正文 → Markdown
    if (article) {
      title = article.title || title;
      byline = article.byline || undefined;
      siteName = article.siteName || undefined;
      if (article.content) {
        try {
          markdown = convertHtmlToMarkdown(article.content, location.href);
        } catch {
          // 转换异常 → 走兜底
        }
      }
    }

    // ② 整页清洗 → Markdown（工具页/登录页等非文章页）
    if (markdown.trim().length < 40) {
      fallback = true;
      try {
        const clone = document.cloneNode(true) as Document;
        markdown = convertHtmlToMarkdown(clone.body, location.href);
      } catch {
        markdown = '';
      }
    }

    // ③ 最终兜底：可见纯文本
    let format: ExtractResult['format'] = 'markdown';
    if (markdown.trim().length < 40) {
      format = 'plaintext';
      markdown = document.body?.innerText ?? '';
    }

    return {
      title,
      byline,
      siteName,
      textContent: markdown,
      length: markdown.length,
      fallback,
      format,
    };
  },
});
