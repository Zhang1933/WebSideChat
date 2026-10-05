import { ExtractError } from '@/lib/extractError';
import type { ExtractResult } from '@/types';

/**
 * YouTube 提取：全程在 sidepanel（扩展上下文）执行，不经过 content script。
 * ① executeScript world:'MAIN' 读播放器 getPlayerResponse() 与用户选中的字幕轨道
 *    （getOption('captions','track')）；没开字幕则提示开启，完全跟随用户选择
 * ② 核心：hook 页面 fetch/XHR 捕获**播放器自己发的** timedtext 请求（带 pot 令牌，
 *    扩展上下文直接 fetch 没有 pot，YouTube 返回 200 空体）——通过 setOption
 *    重选当前轨道强制播放器重新拉取（模拟用户切换字幕），拿到响应体后还原钩子
 * ③ 捕获失败时降级：重放捕获的 URL（带 pot）
 */
export async function extractYouTubeFromPanel(tabId: number): Promise<ExtractResult> {
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
        title: string; author?: string;
        tracks: Track[];
        /** 用户当前选中的字幕轨道（字幕关闭时为 null） */
        activeTrack: Track | null;
        /** 用户开启"自动翻译"时的目标语言代码（如 zh-Hans） */
        translationLanguage?: string;
        /** 捕获到的播放器 timedtext 请求 URL（含 pot 令牌）与响应体 */
        capturedUrl?: string | null;
        capturedBody?: string | null;
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
                videoDetails?: { title?: string; author?: string };
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

      return { ...playerData, capturedUrl, capturedBody };
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
        tracks: { baseUrl?: string; languageCode?: string; kind?: string; vssId?: string }[];
        activeTrack: { baseUrl?: string; languageCode?: string; kind?: string; vssId?: string } | null;
        translationLanguage?: string;
        capturedUrl?: string | null;
        capturedBody?: string | null;
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

  if (!transcript.trim()) {
    throw new ExtractError('字幕获取失败（未能捕获播放器的字幕请求），请确认字幕已在播放器中正常显示后重试');
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
