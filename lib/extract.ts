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
 * ① executeScript world:'MAIN' 轮询播放器 getPlayerResponse()（绕过页面 CSP），
 *    并读取用户当前选中的字幕轨道（getOption('captions','track')）与自动翻译语言
 * ② 完全跟随用户选择：没开字幕则提示开启；开了"自动翻译"则追加 tlang 拉取译文
 * ③ 扩展上下文 fetch timedtext URL（不受 uBlock / 页面 CSP 影响），空响应时 get_transcript 兜底
 */
async function extractYouTubeFromPanel(tabId: number): Promise<ExtractResult> {
  console.log('[WebSideChat extract] extractYouTubeFromPanel 开始, tabId:', tabId);

  // ① 从页面 MAIN world 读取播放器数据
  // getPlayerResponse() 是播放器实时实例（SPA 导航后也正确），但可能尚未初始化；
  // ytInitialPlayerResponse 仅冷启动首帧存在，SPA 后会被覆盖/销毁。
  // 所以轮询等待 getPlayerResponse() 可用，最多 5 秒。
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

      for (let i = 0; i < 20; i++) {
        const r = readPlayer();
        if (r) return r;
        await new Promise((r2) => setTimeout(r2, 250));
      }

      // 兜底：冷加载极早期 getPlayerResponse 不可用 → 读首帧数据（拿不到用户选中状态）
      try {
        const pr = (window as unknown as {
          ytInitialPlayerResponse?: {
            videoDetails?: { title?: string; author?: string };
            captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Track[] } };
          };
        }).ytInitialPlayerResponse;
        const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (tracks?.length) {
          const details = pr?.videoDetails;
          return {
            title: details?.title ?? '',
            author: details?.author,
            tracks,
            activeTrack: null,
          } satisfies PlayerData;
        }
      } catch { /* 继续 */ }
      return null;
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

  // 在轨道列表中找到用户选中轨道的完整 baseUrl（activeTrack 可能缺 baseUrl）
  const active = data.activeTrack;
  let track =
    data.tracks.find(
      (t) => t.languageCode === active.languageCode && (active.vssId ? t.vssId === active.vssId : true),
    ) ?? active;
  if (!track.baseUrl && active.baseUrl) track = active;
  if (!track.baseUrl) throw new ExtractError('字幕轨道信息无效');

  // 用户开了"自动翻译"（如翻译为中文）→ 追加 tlang 拉取翻译后的字幕（播放器同款行为，不在签名参数内）
  let captionUrl = track.baseUrl;
  if (data.translationLanguage && !captionUrl.includes('tlang=')) {
    captionUrl += `&tlang=${encodeURIComponent(data.translationLanguage)}`;
  }
  console.log('[WebSideChat extract] 选轨:', {
    lang: track.languageCode,
    kind: track.kind,
    tlang: data.translationLanguage,
  });

  // ③ fetch timedtext + get_transcript 兜底（pot 令牌缺失时 timedtext 返回空；
  //    兜底走 get_transcript 默认语言，可能不等于用户选择，仅在取不到原文时使用）
  const { parseJson3Transcript, parseTimedTextXml } = await import('@/lib/youtube');
  let transcript = '';

  // 3a: timedtext
  try {
    const ttRes = await fetch(captionUrl, { credentials: 'include' });
    const text = await ttRes.text();
    console.log('[WebSideChat extract] timedtext:', { status: ttRes.status, len: text.length });
    if (ttRes.ok && text.trim()) {
      try { transcript = parseJson3Transcript(JSON.parse(text)); } catch { transcript = parseTimedTextXml(text); }
    }
  } catch (e) {
    console.log('[WebSideChat extract] timedtext 异常:', e);
  }

  // 3b: get_transcript（YouTube"显示转录稿"按钮的端点，不需要 pot）
  if (!transcript.trim()) {
    console.log('[WebSideChat extract] timedtext 为空，尝试 get_transcript...');
    try {
      const videoId = new URL(track.baseUrl).searchParams.get('v') ?? '';
      const gtRes = await fetch(
        `https://www.youtube.com/youtubei/v1/get_transcript?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilJV_Y-DbNMCg`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
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
        }
      }
    } catch (e) {
      console.log('[WebSideChat extract] get_transcript 异常:', e);
    }
  }

  if (!transcript.trim()) {
    throw new ExtractError('字幕获取失败（timedtext 空 + get_transcript 失败），请重试');
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
