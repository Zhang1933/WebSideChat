import { truncateContent } from '@/lib/utils';
import { isYouTubeWatchUrl } from '@/lib/youtube';
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
      if (!m || m.type !== 'websidechat-extract-result') return;
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

/**
 * YouTube 提取：全程在 sidepanel（扩展上下文）执行，不经过 content script。
 * ① executeScript world:'MAIN' 读播放器 getPlayerResponse() 与用户选中的字幕轨道
 *    （getOption('captions','track')）；没开字幕则提示开启，完全跟随用户选择
 * ② 核心：hook 页面 fetch/XHR 捕获**播放器自己发的** timedtext 请求（带 pot 令牌，
 *    扩展上下文直接 fetch 没有 pot，YouTube 返回 200 空体）——通过 setOption
 *    重选当前轨道强制播放器重新拉取（模拟用户切换字幕），拿到响应体后还原钩子
 * ③ 捕获失败时降级：重放捕获的 URL（带 pot）→ get_transcript（带 SAPISIDHASH 鉴权头）
 */
async function extractYouTubeFromPanel(tabId: number): Promise<ExtractResult> {
  console.log('[WebSideChat extract] extractYouTubeFromPanel 开始, tabId:', tabId);

  // ① 从页面 MAIN world 读取播放器数据 + 捕获播放器自己的字幕请求
  // getPlayerResponse() 是播放器实时实例（SPA 导航后也正确），可能尚未初始化，轮询等待。
  let res: { result: unknown } | undefined;
  try {
    const results = await browser.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async () => {
      interface Track { baseUrl?: string; languageCode?: string; kind?: string; vssId?: string }
      interface PlayerData {
        title: string; author?: string; videoId?: string;
        tracks: Track[];
        /** 用户当前选中的字幕轨道（字幕关闭时为 null） */
        activeTrack: Track | null;
        /** 用户开启"自动翻译"时的目标语言代码（如 zh-Hans） */
        translationLanguage?: string;
        /** 捕获到的播放器 timedtext 请求 URL（含 pot 令牌）与响应体 */
        capturedUrl?: string | null;
        capturedBody?: string | null;
        /** 页面算出的 SAPISIDHASH 鉴权头（get_transcript 需要，登录用户才有） */
        sapisidhash?: string | null;
      }

      // 播放器实时实例：轨道列表 + 用户选中状态（SPA 导航后也正确），需轮询等待就绪
      const readPlayer = (): PlayerData | null => {
        try {
          const playerEl = document.getElementById('movie_player') as
            | {
                getPlayerResponse?: () => unknown;
                getOption?: (module: string, option: string) => unknown;
              }
            | null;
          const pr = playerEl?.getPlayerResponse?.() as
            | {
                videoDetails?: { title?: string; author?: string; videoId?: string };
                captions?: {
                  playerCaptionsTracklistRenderer?: { captionTracks?: Track[] };
                };
              }
            | undefined;
          const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (!tracks?.length) return null;

          // 用户在字幕设置里选的轨道；字幕关闭时 getOption 返回 {} → 视为 null
          let activeTrack: Track | null = null;
          try {
            const t = playerEl?.getOption?.('captions', 'track') as Track | undefined;
            if (t && typeof t === 'object' && t.languageCode) activeTrack = t;
          } catch { /* 未设置 */ }

          // 自动翻译目标语言（字幕菜单"自动翻译"里选的）
          let translationLanguage: string | undefined;
          try {
            const tl = playerEl?.getOption?.('captions', 'translationLanguage') as
              | { languageCode?: string }
              | undefined;
            translationLanguage = tl?.languageCode;
          } catch { /* 未设置 */ }

          const details = pr?.videoDetails;
          return {
            title: details?.title ?? '',
            author: details?.author,
            videoId: details?.videoId,
            tracks,
            activeTrack,
            translationLanguage,
          };
        } catch {
          return null;
        }
      };

      // 等待播放器就绪（SPA 导航/冷加载早期 getPlayerResponse 可能未初始化）
      let playerData: PlayerData | null = null;
      for (let i = 0; i < 15; i++) {
        playerData = readPlayer();
        if (playerData) break;
        await new Promise((r2) => setTimeout(r2, 200));
      }
      if (!playerData) return null;

      // get_transcript 兜底用的鉴权头（页面自己的请求带 SAPISIDHASH，缺它会被判 403；未登录无 SAPISID）
      let sapisidhash: string | null = null;
      try {
        const sid = /(?:^|;\s)SAPISID=([^;]+)/.exec(document.cookie)?.[1];
        if (sid) {
          const ts = Math.floor(Date.now() / 1000);
          const bytes = new TextEncoder().encode(`${sid} ${location.origin} ${ts}`);
          const digest = await crypto.subtle.digest('SHA-1', bytes);
          const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
          sapisidhash = `SAPISIDHASH ${ts}_${hash}`;
        }
      } catch { /* ignore */ }

      // 用户开了字幕 → 捕获播放器自己的 timedtext 请求（带 pot；扩展上下文直接 fetch 没有
      // pot，YouTube 返回 200 空体）。做法：hook fetch/XHR 记录响应体 → 强制播放器重新拉取
      // 当前轨道（模拟用户切换字幕）→ 结束后还原钩子与用户的选中状态
      let capturedUrl: string | null = null;
      let capturedBody: string | null = null;
      if (playerData.activeTrack?.languageCode) {
        const activeLang = (playerData.activeTrack.languageCode.split('-')[0] ?? '').toLowerCase();
        const tlang = playerData.translationLanguage?.split('-')[0]?.toLowerCase();
        const isTT = (u: string) => u.includes('/api/timedtext');
        /** 只接受目标语言（或其自动翻译）的捕获；换轨触发产生的其他语言请求不采用 */
        const note = (u: string, body?: string) => {
          if (!isTT(u)) return;
          try {
            const q = new URL(u, location.origin).searchParams;
            const lang = ((q.get('lang') ?? '').split('-')[0] ?? '').toLowerCase();
            const tl = ((q.get('tlang') ?? '').split('-')[0] ?? '').toLowerCase();
            if (lang !== activeLang && !(tlang != null && tl === tlang)) return;
          } catch { /* URL 解析失败，保守接受 */ }
          if (!capturedUrl) capturedUrl = u;
          if (body && body.trim() && !capturedBody) capturedBody = body;
        };
        const origFetch = window.fetch;
        window.fetch = ((...args: Parameters<typeof fetch>) => {
          const req = args[0];
          const u = typeof req === 'string' ? req : ((req as Request)?.url ?? '');
          const p = origFetch(...args);
          if (u.includes('/api/timedtext')) {
            p.then((r) => r.clone().text().then((t) => note(u, t)).catch(() => note(u)))
              .catch(() => note(u));
          }
          return p;
        }) as typeof fetch;
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (
          this: XMLHttpRequest,
          method: string,
          url: string | URL,
          ...rest: unknown[]
        ) {
          const u = String(url);
          if (u.includes('/api/timedtext')) {
            this.addEventListener('load', function (this: XMLHttpRequest) {
              try { note(u, this.responseText); } catch { /* ignore */ }
            });
          }
          return (origOpen as unknown as (...a: unknown[]) => void).apply(this, [method, url, ...rest]);
        };
        try {
          const playerEl2 = document.getElementById('movie_player') as
            | { setOption?: (module: string, option: string, value: unknown) => void }
            | null;
          const active = playerData.activeTrack;
          try { playerEl2?.setOption?.('captions', 'reload', true); } catch { /* 无此选项 */ }
          for (let i = 0; i < 30 && !capturedBody; i++) {
            if (i === 10) {
              // reload 未触发 → 关再开字幕，强制重新拉取当前轨道
              try {
                playerEl2?.setOption?.('captions', 'track', {});
                await new Promise((r2) => setTimeout(r2, 250));
                playerEl2?.setOption?.('captions', 'track', active);
              } catch { /* ignore */ }
            }
            if (i === 20) {
              // 仍未触发 → 切到另一条轨道再切回（必然产生新的网络请求）
              try {
                const other =
                  playerData.tracks.find((t) => (t.languageCode ?? '').split('-')[0] !== activeLang) ??
                  playerData.tracks[0];
                if (other && other !== active) {
                  playerEl2?.setOption?.('captions', 'track', other);
                  await new Promise((r2) => setTimeout(r2, 400));
                  playerEl2?.setOption?.('captions', 'track', active);
                }
              } catch { /* ignore */ }
            }
            await new Promise((r2) => setTimeout(r2, 200));
          }
          // 还原用户选中的轨道
          try { playerEl2?.setOption?.('captions', 'track', active); } catch { /* ignore */ }
        } finally {
          window.fetch = origFetch;
          XMLHttpRequest.prototype.open = origOpen;
        }
      }

      return { ...playerData, capturedUrl, capturedBody, sapisidhash };
    },
    });
    res = results?.[0] as { result: unknown } | undefined;
  } catch (e) {
    console.error('[WebSideChat extract] executeScript 失败:', e);
    throw new ExtractError(`页面脚本执行失败: ${String(e)}`);
  }

  console.log('[WebSideChat extract] executeScript:', {
    hasData: !!res?.result,
    dataPreview: res?.result ? JSON.stringify(res.result).slice(0, 100) : 'null',
  });

  const data = res?.result as
    | {
        title: string;
        author?: string;
        videoId?: string;
        tracks: { baseUrl?: string; languageCode?: string; kind?: string; vssId?: string }[];
        activeTrack: { baseUrl?: string; languageCode?: string; kind?: string; vssId?: string } | null;
        translationLanguage?: string;
        capturedUrl?: string | null;
        capturedBody?: string | null;
        sapisidhash?: string | null;
      }
    | null;

  if (!data) {
    throw new ExtractError('无法读取页面播放器数据，请确认在视频播放页');
  }
  if (!data.tracks || data.tracks.length === 0) {
    throw new ExtractError('该视频没有可用字幕（纯音乐或未开启字幕），无法总结');
  }
  // 用户没开字幕（或选中的轨道读不到语言）→ 要求先开启，完全跟随用户选择
  if (!data.activeTrack?.languageCode) {
    throw new ExtractError('请先在播放器中开启字幕并选择语言（CC 按钮 → 字幕），然后重新提取');
  }

  const { parseJson3Transcript, parseTimedTextXml } = await import('@/lib/youtube');
  const parseBody = (raw: string): string => {
    try {
      return parseJson3Transcript(JSON.parse(raw));
    } catch {
      return parseTimedTextXml(raw);
    }
  };
  let transcript = '';

  // ① 播放器自己请求到的字幕响应体（页面上下文带 pot，最可靠）
  if (data.capturedBody?.trim()) {
    transcript = parseBody(data.capturedBody);
    console.log('[WebSideChat extract] ① 捕获播放器字幕响应体:', { len: data.capturedBody.length });
  }

  // ② 捕获到的请求 URL（带 pot）→ 扩展上下文重放
  if (!transcript.trim() && data.capturedUrl) {
    try {
      const r = await fetch(data.capturedUrl, { credentials: 'include' });
      const text = await r.text();
      console.log('[WebSideChat extract] ② 重放捕获的 timedtext URL:', { status: r.status, len: text.length });
      if (r.ok && text.trim()) transcript = parseBody(text);
    } catch (e) {
      console.log('[WebSideChat extract] ② 重放异常:', e);
    }
  }

  // ③ get_transcript 兜底（"显示转录稿"按钮的端点；返回默认语言，可能不等于用户选择）
  if (!transcript.trim()) {
    console.log('[WebSideChat extract] ①② 均未取到，尝试 get_transcript...');
    try {
      let videoId = data.videoId ?? '';
      if (!videoId) {
        const withUrl = data.tracks.find((t) => t.baseUrl);
        if (withUrl?.baseUrl) videoId = new URL(withUrl.baseUrl).searchParams.get('v') ?? '';
      }
      if (videoId) {
        const gtRes = await fetch(
          `https://www.youtube.com/youtubei/v1/get_transcript?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilJV_Y-DbNMCg`,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              // 页面自己的 get_transcript 带 SAPISIDHASH 鉴权头，缺失会被判 403
              ...(data.sapisidhash ? { Authorization: data.sapisidhash } : {}),
            },
            body: JSON.stringify({
              context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00' } },
              params: btoa(`\x0a${String.fromCharCode(videoId.length)}${videoId}`),
            }),
          },
        );
        const gtRaw = await gtRes.text();
        console.log('[WebSideChat extract] get_transcript:', { status: gtRes.status, len: gtRaw.length });
        if (gtRes.ok && gtRaw.trim()) {
          const gtData = JSON.parse(gtRaw);
          const segments = gtData?.actions?.[0]?.updateEngagementPanelAction?.content
            ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body
            ?.transcriptSegmentListRenderer?.initialSegments;
          if (Array.isArray(segments)) {
            const lines: string[] = [];
            for (const seg of segments) {
              const r = seg?.transcriptSegmentRenderer;
              if (!r) continue;
              const text = (r.snippet?.runs ?? []).map((run: { text?: string }) => run.text ?? '').join('').trim();
              if (!text) continue;
              const timeStr = r.startTimeText?.simpleText ?? '0:00';
              const parts = timeStr.split(':').map(Number);
              const totalSec = parts.reduce((acc: number, p: number) => acc * 60 + p, 0);
              const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
              const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
              const s = String(totalSec % 60).padStart(2, '0');
              lines.push(`[${h}:${m}:${s}] ${text}`);
            }
            transcript = lines.join('\n');
          } else {
            console.log('[WebSideChat extract] get_transcript 响应结构异常:', gtRaw.slice(0, 200));
          }
        }
      }
    } catch (e) {
      console.log('[WebSideChat extract] get_transcript 异常:', e);
    }
  }

  if (!transcript.trim()) {
    throw new ExtractError('字幕获取失败（播放器捕获与 get_transcript 均未取到），请确认字幕已在播放器中正常显示后重试');
  }

  return {
    title: data.title || '',
    byline: data.author,
    siteName: 'YouTube',
    textContent: transcript,
    length: transcript.length,
    fallback: false,
    format: 'markdown',
  };
}

/** 注入提取脚本并截断正文（在 Side Panel 上下文调用） */
export async function extractCurrentPage(
  tabId: number,
  maxChars: number,
  pageUrl?: string,
): Promise<ExtractSuccess> {
  let raw: ExtractResult | undefined;

  // YouTube：全程走扩展上下文，不注入 content script
  console.log('[WebSideChat extract] extractCurrentPage:', { pageUrl: pageUrl?.slice(0, 60), isYouTube: pageUrl ? isYouTubeWatchUrl(pageUrl) : false });
  if (pageUrl && isYouTubeWatchUrl(pageUrl)) {
    raw = await extractYouTubeFromPanel(tabId);
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
