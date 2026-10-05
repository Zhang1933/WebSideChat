/** YouTube 字幕提取的纯函数（在 content script 与单测中使用） */

export interface CaptionTrack {
  baseUrl: string;
  languageCode?: string;
  /** 'asr' = 自动生成；缺省 = 手动上传（质量更高） */
  kind?: string;
  vssId?: string;
}

/** playerCaptionsTracklistRenderer 的形状（含多音轨视频的默认轨道标记） */
export interface TracklistRenderer {
  captionTracks?: CaptionTrack[];
  audioTracks?: { defaultCaptionTrackIndex?: number; captionTrackIndices?: number[] }[];
}

/** 是否为 YouTube 观看页（watch / shorts；m.youtube.com 也算） */
export function isYouTubeWatchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/(^|\.)youtube\.com$/.test(u.hostname.toLowerCase())) return false;
    return u.pathname === '/watch' || u.pathname.startsWith('/shorts/');
  } catch {
    return false;
  }
}

/** 从 URL 提取 11 位视频 ID（watch?v= 或 /shorts/） */
export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const shorts = u.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{6,})/);
    return shorts?.[1] ?? null;
  } catch {
    return null;
  }
}

/** 秒 → [HH:MM:SS] 时间戳（含小时，超长视频不歧义） */
function formatTimestamp(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `[${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}]`;
}

/** timedtext 的 json3 响应 → 带时间戳的逐行文本（[HH:MM:SS] 一行），便于"第 X 分钟讲了什么"类提问 */
export function parseJson3Transcript(json: unknown): string {
  const events = (json as { events?: unknown[] })?.events;
  if (!Array.isArray(events)) return '';
  const lines: string[] = [];
  for (const ev of events) {
    const segs = (ev as { segs?: { utf8?: string }[] })?.segs;
    if (!Array.isArray(segs)) continue;
    const text = segs
      .map((s) => (typeof s.utf8 === 'string' ? s.utf8 : ''))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    const totalSec = Math.floor((Number((ev as { tStartMs?: number }).tStartMs) || 0) / 1000);
    lines.push(`${formatTimestamp(totalSec)} ${text}`);
  }
  return lines.join('\n');
}

/** timedtext 默认 XML（<transcript><text start="秒">…</text></transcript>）→ 同格式的带时间戳文本 */
export function parseTimedTextXml(xml: string): string {
  if (!xml.includes('<transcript')) return '';
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const lines: string[] = [];
    for (const node of Array.from(doc.querySelectorAll('text'))) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const totalSec = Math.floor(Number(node.getAttribute('start')) || 0);
      lines.push(`${formatTimestamp(totalSec)} ${text}`);
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}
