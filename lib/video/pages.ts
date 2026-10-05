import { isBilibiliVideoUrl } from '@/lib/bilibili';
import { extractVideoId, isYouTubeWatchUrl } from '@/lib/youtube';

export type VideoSite = 'youtube' | 'bilibili';

/** 识别视频站点（决定视频系统提示词、时间戳模板与 seek 行为）；非视频页返回 null */
export function videoSiteOf(url?: string | null): VideoSite | null {
  if (!url) return null;
  if (isYouTubeWatchUrl(url)) return 'youtube';
  if (isBilibiliVideoUrl(url)) return 'bilibili';
  return null;
}

/** 是否为视频页（YouTube watch/shorts 或 B 站 /video/） */
export function isVideoPageUrl(url?: string | null): boolean {
  return videoSiteOf(url) != null;
}

/**
 * 生成时间戳跳转完整 URL（渲染层展开用，模型不接触真实 URL）：
 * - YouTube: https://www.youtube.com/watch?v=xx&t=秒s
 * - B 站: https://www.bilibili.com/video/BVxx（仅保留 ?p= 分 P 参数，剥追踪参数）+ &t=秒
 * 非视频页返回 null。
 */
export function timestampUrl(url: string, seconds: number): string | null {
  if (isYouTubeWatchUrl(url)) {
    const videoId = extractVideoId(url);
    return videoId ? `https://www.youtube.com/watch?v=${videoId}&t=${seconds}s` : null;
  }
  if (isBilibiliVideoUrl(url)) {
    try {
      const u = new URL(url);
      const p = u.searchParams.get('p');
      const base = `https://www.bilibili.com${u.pathname}`;
      return `${base}${p ? `?p=${p}&` : '?'}t=${seconds}`;
    } catch {
      return null;
    }
  }
  return null;
}

/** 解析时间戳文字（MM:SS 或 HH:MM:SS，可含反引号）→ 秒数；格式非法返回 null */
export function parseTimestampText(text: string): number | null {
  const m = text
    .trim()
    .replace(/`/g, '')
    .match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2]);
  const s = Number(m[3]);
  if (min > 59 || s > 59) return null;
  return h * 3600 + min * 60 + s;
}

/**
 * 渲染层展开：把模型输出的时间戳占位链接 [`05:30`](#t) 替换为完整跳转 URL。
 * 秒数从链接文字解析（模型不需要换算）；非时间文字、无视频 URL 时原样保留。
 */
export function expandTimestampLinks(text: string, videoUrl?: string | null): string {
  if (!videoUrl) return text;
  return text.replace(/\[([^\]]*)\]\(#t\)/gi, (whole, label: string) => {
    const sec = parseTimestampText(label);
    if (sec == null) return whole;
    const url = timestampUrl(videoUrl, sec);
    return url ? `[${label}](${url})` : whole;
  });
}
