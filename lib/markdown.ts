import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

/** 对摘要无意义、且体积巨大的节点，转换前剔除 */
const STRIP_TAGS =
  'script, style, noscript, template, svg, iframe, object, embed, link, meta';

export function stripJunk(root: Element | Document): void {
  root.querySelectorAll(STRIP_TAGS).forEach((el) => el.remove());
}

/**
 * HTML → Markdown 转换器（turndown + GFM 表格/删除线/任务列表）。
 *
 * 自定义规则：
 * - 链接绝对化（相对 href 基于页面 URL 解析），锚点链接只留文字
 * - 图片不保留 URL，转为 [图片：alt]（省 token，alt 对理解页面更有用）
 */
export function convertHtmlToMarkdown(input: string | HTMLElement, baseUrl?: string): string {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    hr: '---',
    emDelimiter: '*',
  });
  service.use(gfm);

  service.addRule('absoluteLinks', {
    filter: 'a',
    replacement: (content, node) => {
      const href = (node as HTMLAnchorElement).getAttribute('href');
      if (!href || href.startsWith('#') || !content.trim()) return content;
      try {
        const abs = new URL(href, baseUrl).toString();
        return `[${content}](${abs})`;
      } catch {
        return content;
      }
    },
  });

  service.addRule('imagesAsAltText', {
    filter: 'img',
    replacement: (_content, node) => {
      const alt = ((node as HTMLImageElement).getAttribute('alt') ?? '').trim();
      return alt ? `[图片：${alt}]` : '';
    },
  });

  let node: string | HTMLElement;
  if (typeof input === 'string') {
    const doc = new DOMParser().parseFromString(input, 'text/html');
    stripJunk(doc);
    node = doc.body;
  } else {
    // 就地剔除（调用方传入的是克隆节点，不影响页面）
    stripJunk(input);
    node = input;
  }
  return service.turndown(node);
}
