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

/** 从观看页 HTML 提取 INNERTUBE_API_KEY（youtube-transcript-api 同款正则） */
export function extractInnertubeApiKey(html: string): string | null {
  const m = html.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/);
  return m?.[1] ?? null;
}

/** 剥掉 baseUrl 里内嵌的 fmt 参数（如 &fmt=srv3），避免与后续拼接的格式参数冲突 */
export function stripFmtParam(baseUrl: string): string {
  return baseUrl.replace(/([?&])fmt=[^&]*/g, '').replace(/\?&/, '?').replace(/&&/g, '&');
}

/**
 * 校验 Innertube player 响应的 playabilityStatus（youtube-transcript-api 的状态映射）。
 * 可播放返回 null；否则返回用户可读的错误文案。
 */
export function checkPlayability(playability: unknown): string | null {
  const p = playability as { status?: string; reason?: string } | null;
  if (!p || !p.status || p.status === 'OK') return null;
  const reason = p.reason ?? '';
  if (p.status === 'LOGIN_REQUIRED') {
    if (reason.includes('not a bot')) return '请求被 YouTube 风控拦截（要求登录验证），请稍后重试';
    if (reason.includes('inappropriate')) return '年龄限制视频，无法获取字幕';
    return `需要登录才能观看（${reason || 'LOGIN_REQUIRED'}）`;
  }
  if (p.status === 'ERROR' && reason.includes('unavailable')) {
    return '视频不可用（可能已删除或地区限制）';
  }
  return `视频无法播放：${reason || p.status}`;
}

/**
 * 从观看页 HTML 中解析 ytInitialPlayerResponse。
 * 用括号配对扫描（处理嵌套对象与字符串内的花括号），不做正则截断。
 */
export function extractPlayerResponse(html: string): Record<string, unknown> | null {
  const marker = html.indexOf('ytInitialPlayerResponse');
  if (marker === -1) return null;
  const start = html.indexOf('{', marker);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * 从字幕轨道列表选择，优先级：
 * ① preferLangs 命中的语言（按序，如 zh）——存在中文轨道则优先
 * ② defaultIndex 指向的默认轨道（多音轨/自动配音视频的**原声语言**标记，
 *    来自 audioTracks[].defaultCaptionTrackIndex，避免英文视频选到配音字幕）
 * ③ 手动上传（非 asr）的第一条
 * ④ 第一条
 */
export function pickCaptionTrack(
  tracks: CaptionTrack[],
  opts: { defaultIndex?: number; preferLangs?: string[] } = {},
): CaptionTrack | null {
  if (tracks.length === 0) return null;
  const prefer = (opts.preferLangs ?? []).map((l) => l.toLowerCase());

  for (const lang of prefer) {
    const hits = tracks.filter((t) => t.languageCode?.toLowerCase().startsWith(lang));
    if (hits.length > 0) {
      // 同一语言内手动上传（非 asr）优先
      return hits.find((t) => !t.kind) ?? hits[0]!;
    }
  }

  const defIdx = opts.defaultIndex;
  if (defIdx != null && defIdx >= 0 && defIdx < tracks.length) {
    return tracks[defIdx]!;
  }

  return tracks.find((t) => !t.kind) ?? tracks[0] ?? null;
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
