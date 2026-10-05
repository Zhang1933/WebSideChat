import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/** 是否为抽屉模式（运行在注入 iframe 中） */
const IN_DRAWER = typeof window !== 'undefined' && window.self !== window.top;

/**
 * 拦截 YouTube 时间戳链接点击：仅在视频页面板中生效。
 * 不做页面导航，而是 seek 当前页面的 <video> 到对应秒数（体验同 YouTube 评论区）。
 * 普通网页中不拦截（可能是引用外部视频的链接，应正常打开）。
 */
function makeClickHandler(isVideoPage: boolean) {
  return function handleMarkdownClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!isVideoPage) return; // 普通网页：不拦截任何链接

    const anchor = (e.target as HTMLElement).closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href) return;

    // 提取 YouTube 链接的 t= 参数（秒数）
    const match = href.match(/[?&]t=(\d+)s?/);
    if (!match) return; // 非时间戳链接，走默认行为

    const isYouTube = href.includes('youtube.com/watch') || href.includes('youtu.be/');
    if (!isYouTube) return;

    e.preventDefault();
    const seconds = Number(match[1]);

    if (IN_DRAWER) {
      // 抽屉模式：postMessage 通知 content script seek 当前页面的 <video>
      window.parent.postMessage({ type: 'websidechat-drawer', action: 'seek', seconds }, '*');
    } else {
    // 原生侧边栏：对当前激活标签页注入 seek 脚本
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        if (tab?.id != null) {
          return browser.scripting.executeScript({
            target: { tabId: tab.id },
            func: (s: number) => {
              const video = document.querySelector('video');
              if (video) {
                video.currentTime = s;
                video.play().catch(() => {});
              }
            },
            args: [seconds],
          });
        }
      })
      .catch(() => {
        // 不可注入页（chrome:// 等）→ 回退为新标签页打开
        window.open(href, '_blank');
      });
    }
  };
}

/** Markdown 渲染（摘要与回复共用，支持流式增量重渲染）；视频页面板拦截时间戳链接 seek 播放器 */
export function Markdown({
  text,
  className,
  isVideoPage = false,
}: {
  text: string;
  className?: string;
  /** 当前是否在视频页（YouTube 观看页）：为 true 时拦截时间戳链接做本地 seek */
  isVideoPage?: boolean;
}) {
  return (
    <div
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none break-words prose-headings:mb-1 prose-headings:mt-3 prose-p:my-1.5 prose-li:my-0.5 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none',
        className,
      )}
      onClick={makeClickHandler(isVideoPage)}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
