import { Readability } from '@mozilla/readability';
import { convertHtmlToMarkdown } from '@/lib/markdown';
import {
  checkPlayability,
  extractInnertubeApiKey,
  extractPlayerResponse,
  extractVideoId,
  isYouTubeWatchUrl,
  parseJson3Transcript,
  parseTimedTextXml,
  pickCaptionTrack,
  stripFmtParam,
} from '@/lib/youtube';
import type { ExtractResult } from '@/types';

/** YouTube 分支的失败/空结果（panel 侧转为用户可读错误） */
function youtubeError(message: string): ExtractResult {
  return {
    title: document.title,
    textContent: '',
    length: 0,
    fallback: false,
    format: 'plaintext',
    error: message,
  };
}

/**
 * 拉取字幕文本：json3 优先，空/非 JSON 响应降级到默认 XML（DOMParser 解析）。
 * YouTube 对部分请求会返回 200 + 空 body（fmt 参数或会话上下文不被接受），必须按文本处理。
 * baseUrl 应先经 stripFmtParam 处理。
 */
async function fetchTranscript(baseUrl: string): Promise<string> {
  // ① json3
  try {
    const r = await fetch(`${baseUrl}&fmt=json3`, { credentials: 'include' });
    if (r.ok) {
      const text = await r.text();
      if (text.trim()) {
        try {
          const transcript = parseJson3Transcript(JSON.parse(text));
          if (transcript.trim()) return transcript;
        } catch {
          // 非 JSON（如 XML 错误页）→ 走 XML 降级
        }
      }
    }
  } catch {
    // 网络异常 → 走 XML 降级
  }
  // ② 默认 XML 格式
  try {
    const r = await fetch(baseUrl, { credentials: 'include' });
    if (r.ok) {
      const transcript = parseTimedTextXml(await r.text());
      if (transcript.trim()) return transcript;
    }
  } catch {
    // 忽略，走失败路径
  }
  return '';
}

interface PlayerLike {
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: unknown[] } } | undefined;
  videoDetails?: { title?: string; author?: string } | undefined;
}

/**
 * YouTube 观看页：以字幕（timedtext）作为对话上下文，不读网页正文。
 * 参考 youtube-transcript-api 的方案：主路径走 Innertube player API（ANDROID 客户端
 * 上下文，生成的字幕 URL 通常不带 exp=xpe/pot 要求），页面内嵌 ytInitialPlayerResponse
 * 作兜底。全部请求在页面源内发起（带用户 Cookie 与浏览器上下文）。
 */
async function extractYouTube(): Promise<ExtractResult> {
  const videoId = extractVideoId(location.href);
  if (!videoId) return youtubeError('无法从 URL 解析视频 ID，请确认在视频播放页');
  try {
    // 观看页 HTML：提供 INNERTUBE_API_KEY 与兜底的 ytInitialPlayerResponse
    const page = await fetch(location.href, { credentials: 'include' });
    if (!page.ok) return youtubeError(`获取视频信息失败（HTTP ${page.status}）`);
    const html = await page.text();

    // ① Innertube（ANDROID 客户端）—— youtube-transcript-api 的核心方案
    let tracks: unknown = null;
    let details: { title?: string; author?: string } | undefined;
    let playabilityIssue: string | null = null;
    const apiKey = extractInnertubeApiKey(html);
    if (apiKey) {
      try {
        const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
            videoId,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as
            | { playabilityStatus?: unknown; captions?: PlayerLike['captions']; videoDetails?: PlayerLike['videoDetails'] }
            | null;
          playabilityIssue = checkPlayability(data?.playabilityStatus);
          if (!playabilityIssue) {
            tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? null;
            details = data?.videoDetails;
          }
        }
      } catch {
        // Innertube 调用失败 → 走页面内嵌数据兜底
      }
    }

    // ② 兜底：页面内嵌 ytInitialPlayerResponse（WEB 客户端数据）
    if (!Array.isArray(tracks) || tracks.length === 0) {
      const player = extractPlayerResponse(html) as PlayerLike | null;
      if (!details) details = player?.videoDetails;
      tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? null;
    }

    if (!Array.isArray(tracks) || tracks.length === 0) {
      return youtubeError(playabilityIssue ?? '该视频没有可用字幕（纯音乐或未开启字幕），无法总结');
    }
    const track = pickCaptionTrack(tracks as Parameters<typeof pickCaptionTrack>[0]);
    if (!track?.baseUrl) return youtubeError('字幕轨道信息无效');

    // 剥掉内嵌 fmt 参数再拼接；exp=xpe = 需要 pot 令牌的标记
    const baseUrl = stripFmtParam(track.baseUrl);
    const needsPot = /[?&]exp=xpe/.test(track.baseUrl);

    const transcript = await fetchTranscript(baseUrl);
    if (!transcript.trim()) {
      return youtubeError(
        needsPot
          ? '字幕 URL 需要 pot 令牌（YouTube 风控），请重试或换一个视频'
          : '字幕接口返回空内容：该视频可能限制字幕获取，请重试或换一个视频',
      );
    }

    return {
      title: details?.title || document.title,
      byline: details?.author || undefined,
      siteName: 'YouTube',
      textContent: transcript,
      length: transcript.length,
      fallback: false,
      format: 'markdown',
    };
  } catch (err) {
    return youtubeError(`字幕提取失败：${String(err)}`);
  }
}

/**
 * 正文提取脚本（按需注入，不常驻）。
 *
 * registration: 'runtime' → 不进 manifest，构建产物 /content-scripts/extract.js，
 * 由 Side Panel 通过 browser.scripting.executeScript({ files }) 显式注入。
 *
 * 普通页面：main() 同步返回值经 results[0].result 回传（三级策略：
 * ① Readability 正文 → Markdown；② 整页清洗转换；③ innerText 兜底）。
 * YouTube：files 注入不会等待 Promise，改为异步提取后经 runtime.sendMessage
 * 回传，同步返回 { asyncPending: true } 通知 panel 等待消息。
 */
export default defineContentScript({
  registration: 'runtime',

  main(): ExtractResult | { asyncPending: true } {
    // YouTube 分支：字幕作为上下文（替代网页正文）
    if (isYouTubeWatchUrl(location.href)) {
      void extractYouTube()
        .then((result) => {
          void browser.runtime.sendMessage({ type: 'webchat-extract-result', result });
        })
        .catch(() => {
          void browser.runtime.sendMessage({
            type: 'webchat-extract-result',
            result: youtubeError('字幕提取失败'),
          });
        });
      return { asyncPending: true };
    }

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
