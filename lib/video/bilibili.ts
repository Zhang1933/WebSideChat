import { ExtractError } from '@/lib/extractError';
import { t } from '@/lib/i18n';
import type { ExtractResult } from '@/types';

/**
 * B 站提取：模拟用户操作字幕菜单，捕获播放器自己的字幕请求（与 YouTube 同思路）。
 * ① executeScript world:'MAIN' 读 __INITIAL_STATE__.videoData（aid/cid/标题/UP 主/分 P）
 * ② 核心：hook fetch/XHR 捕获**播放器自己拉的**字幕 JSON（hdslb.com，auth_key 天然有效）——
 *    在字幕菜单里点中文语言项（data-lan 含 zh，手动优先于 AI）触发加载；
 *    原本开着字幕则先点"关闭"再选（强制重新拉取），截到后还原原状态
 * ③ 捕获失败时降级：nav 取 wbi 密钥本地签名 → x/player/wbi/v2 字幕列表 →
 *    选中文 → 拉字幕 JSON
 */
export async function extractBilibiliFromPanel(tabId: number): Promise<ExtractResult> {
  console.log('[WebSideChat extract] extractBilibiliFromPanel 开始, tabId:', tabId);

  // ① 页面数据 + 捕获播放器自己的字幕请求
  let res: { result: unknown } | undefined;
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async () => {
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

        const vd = (window as unknown as {
          __INITIAL_STATE__?: {
            videoData?: {
              aid?: number;
              cid?: number;
              title?: string;
              owner?: { name?: string };
              pages?: { cid?: number; part?: string }[];
            };
          };
        }).__INITIAL_STATE__?.videoData;
        if (!vd?.aid || !vd?.cid) return null;

        // 多 P 视频：标题带上当前分 P
        const pages = Array.isArray(vd.pages) ? vd.pages : [];
        const idx = pages.findIndex((p) => p.cid === vd.cid);
        let title = vd.title ?? '';
        if (pages.length > 1 && idx >= 0) {
          title = `${title} P${idx + 1}${pages[idx]?.part ? ` ${pages[idx].part}` : ''}`;
        }

        // hook fetch/XHR 捕获 hdslb 字幕响应（aisubtitle.hdslb.com / xxx/bfs/subtitle/...）
        let capturedBody: string | null = null;
        let capturedLan: string | null = null;
        const isSub = (u: string) => u.includes('hdslb.com') && u.includes('subtitle');
        const note = (u: string, body?: string) => {
          if (!isSub(u)) return;
          if (body && body.trim() && !capturedBody) capturedBody = body;
        };
        const origFetch = window.fetch;
        window.fetch = ((...args: Parameters<typeof fetch>) => {
          const req = args[0];
          const u = typeof req === 'string' ? req : ((req as Request)?.url ?? '');
          const p = origFetch(...args);
          if (isSub(u)) {
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
          if (isSub(u)) {
            this.addEventListener('load', function (this: XMLHttpRequest) {
              try { note(u, this.responseText); } catch { /* ignore */ }
            });
          }
          return (origOpen as unknown as (...a: unknown[]) => void).apply(this, [method, url, ...rest]);
        };
        // 静默字幕操作：模拟点击期间隐藏 toast 与画面上的字幕渲染层——
        // 字幕轨道虽被短暂开启以触发拉取，但全程不渲染、无提示，用户无感
        const silentStyle = document.createElement('style');
        silentStyle.textContent = [
          // 切换提示（"字幕已切换至中文"等），类名实测自 bpx 播放器 DOM
          '.bpx-player-toast-auto,.bpx-player-toast-row',
          // 字幕正文渲染层（多写几个候选，命不中顶多闪现、无副作用）
          '.bpx-player-subtitle,.bpx-player-subtitle-wrap,.bpx-player-video-subtitle',
        ].join(',') + '{display:none!important}';
        document.documentElement.appendChild(silentStyle);

        // toast 刺客：toast 出生后存活 2-3s，纯 CSS 隐藏存在"样式先撤、toast
        // 还活着"的时序竞争。观察者把窗口期内新建的 toast 节点直接移出 DOM——
        // 节点不存在，就永远没有竞争。作用域限定播放器容器，避免全页开销
        const TOAST_SEL = '.bpx-player-toast-auto,.bpx-player-toast-row';
        const toastMo = new MutationObserver((muts) => {
          for (const m of muts) {
            for (const n of m.addedNodes) {
              if (!(n instanceof HTMLElement)) continue;
              if (n.matches(TOAST_SEL) || n.querySelector(TOAST_SEL)) n.remove();
            }
          }
        });
        const playerRoot = document.querySelector('.bpx-player') ?? document.documentElement;
        toastMo.observe(playerRoot, { childList: true, subtree: true });

        try {
          // 字幕设置面板：语言项（主字幕区优先）+ 关闭开关（bpx 播放器 DOM）
          const items = Array.from(
            document.querySelectorAll('.bpx-player-ctrl-subtitle-language-item'),
          ) as (HTMLElement & { dataset: { lan?: string } })[];
          const zhItems = items.filter((el) => /(^|-)zh/i.test(el.dataset.lan ?? ''));
          // 手动上传（非 ai-）质量高于 AI 生成
          const zhItem = zhItems.find((el) => !/^ai-/i.test(el.dataset.lan ?? '')) ?? zhItems[0];

          if (zhItem) {
            capturedLan = zhItem.dataset.lan ?? null;
            // 面板可能在捕获等待期间重渲染，关闭开关每次现查、不持旧引用
            const closeSwitchNow = () =>
              document.querySelector('.bpx-player-ctrl-subtitle-close-switch') as
                | HTMLElement
                | null;
            // 关闭开关带 bpx-state-active = 字幕当前关闭
            const isOff = (sw: HTMLElement | null) => !!sw?.classList.contains('bpx-state-active');
            const wasOff = isOff(closeSwitchNow());
            // 用户原本选中的语言轨：抓完还原，不改变用户选择（原本开着的非中文轨）
            const origItem =
              items.find((el) => el.classList.contains('bpx-state-active')) ?? null;
            // 原本开着 → 先关再选中文轨，强制播放器重新拉取（缓存不重复请求）。
            // 注意"开"必须点语言轨而非开关：纯开关走内存缓存不发请求，抓不到包
            if (!wasOff) {
              closeSwitchNow()?.click();
              await sleep(250);
            }
            zhItem.click();
            // 100ms 轮询：抓到立即往下走，字幕暴露窗口越短越好（渲染层已被 CSS 隐藏）
            for (let i = 0; i < 40 && !capturedBody; i++) await sleep(100);
            // 原本关着 → 立即关回去；原本开着且原轨非中文 → 把用户的选择点回去。
            // 均只快速点一次、不校验不重试：校验依据的 active 类语义若与预期
            // 相反，重试反而会把字幕来回切换，比偶尔没还原更糟
            if (wasOff) closeSwitchNow()?.click();
            else if (origItem && origItem !== zhItem) origItem.click();
          }
        } finally {
          // 最后一次还原点击的 toast 由播放器异步创建：观察者会在其出生瞬间
          // 删掉它，故延迟 2s 再统一撤除样式与观察者（不阻塞提取结果返回）
          setTimeout(() => {
            silentStyle.remove();
            toastMo.disconnect();
          }, 2000);
          window.fetch = origFetch;
          XMLHttpRequest.prototype.open = origOpen;
        }

        return { aid: vd.aid, cid: vd.cid, title, author: vd.owner?.name, capturedLan, capturedBody };
      },
    });
    res = results?.[0] as { result: unknown } | undefined;
  } catch (e) {
    throw new ExtractError(t('err.extract.scriptFail', String(e)));
  }

  const data = res?.result as
    | {
        aid: number;
        cid: number;
        title: string;
        author?: string;
        capturedLan: string | null;
        capturedBody: string | null;
      }
    | null;
  if (!data) {
    throw new ExtractError(t('err.bili.noVideoData'));
  }
  console.log('[WebSideChat extract] B站视频数据:', {
    aid: data.aid,
    cid: data.cid,
    lan: data.capturedLan,
    hasCaptured: !!data.capturedBody,
  });

  const { pickBilibiliSubtitle, parseBilibiliSubtitle } = await import('@/lib/bilibili');

  // ② 播放器自己拉到的字幕响应体（auth_key 天然有效，最可靠）
  let transcript = '';
  if (data.capturedBody?.trim()) {
    try {
      transcript = parseBilibiliSubtitle(JSON.parse(data.capturedBody));
    } catch { /* 非 JSON */ }
    console.log('[WebSideChat extract] ① 捕获播放器字幕响应体:', {
      len: data.capturedBody.length,
      parsed: transcript.length,
    });
  }

  // ③ 降级：wbi 签名调 x/player/wbi/v2 字幕列表（AI 字幕需登录 cookies）
  if (!transcript.trim()) {
    let candidates: string[] = [
      `https://api.bilibili.com/x/player/v2?aid=${data.aid}&cid=${data.cid}`,
    ];
    try {
      const { extractWbiKey, getMixinKey, signWbiParams } = await import('@/lib/bilibili');
      const navRes = await fetch('https://api.bilibili.com/x/web-interface/nav', {
        credentials: 'include',
      });
      const navJson = (await navRes.json()) as {
        data?: { wbi_img?: { img_url?: string; sub_url?: string } };
      };
      const imgUrl = navJson?.data?.wbi_img?.img_url;
      const subUrl = navJson?.data?.wbi_img?.sub_url;
      if (imgUrl && subUrl) {
        const signed = signWbiParams(
          { aid: data.aid, cid: data.cid },
          getMixinKey(extractWbiKey(imgUrl), extractWbiKey(subUrl)),
        );
        candidates = [`https://api.bilibili.com/x/player/wbi/v2?${signed}`, ...candidates];
      }
    } catch (e) {
      console.log('[WebSideChat extract] wbi 密钥获取失败，退化无签名接口:', e);
    }

    let subEntry: ReturnType<typeof pickBilibiliSubtitle> = null;
    let failReason = '';
    for (const url of candidates) {
      try {
        const r = await fetch(url, { credentials: 'include' });
        const text = await r.text();
        let json: { code?: number; message?: string; data?: { subtitle?: unknown } } | undefined;
        try {
          json = JSON.parse(text);
        } catch { /* 非 JSON */ }
        if (json?.code === 0) {
          subEntry = pickBilibiliSubtitle(
            (json.data?.subtitle ?? {}) as Parameters<typeof pickBilibiliSubtitle>[0],
          );
          if (subEntry) {
            console.log('[WebSideChat extract] ② 字幕列表命中:', { lan: subEntry.lan });
          } else {
            failReason = t('err.bili.noZhCaptions');
          }
          break;
        }
        failReason = t('err.bili.listCode', json?.code ?? r.status, json?.message ? `：${json.message}` : '');
      } catch (e) {
        failReason = t('err.bili.listFail', String(e));
      }
    }
    if (subEntry?.subtitle_url) {
      let subUrl = subEntry.subtitle_url;
      if (subUrl.startsWith('//')) subUrl = `https:${subUrl}`;
      try {
        const r = await fetch(subUrl, { credentials: 'include' });
        const text = await r.text();
        console.log('[WebSideChat extract] ② 接口字幕:', { status: r.status, len: text.length });
        if (r.ok && text.trim()) transcript = parseBilibiliSubtitle(JSON.parse(text));
      } catch (e) {
        console.log('[WebSideChat extract] ② 接口字幕异常:', e);
      }
    }
    if (!transcript.trim()) {
      throw new ExtractError(failReason || t('err.bili.noZhCaptions'));
    }
  }

  return {
    title: data.title || '',
    byline: data.author,
    siteName: '哔哩哔哩',
    textContent: transcript,
    length: transcript.length,
    fallback: false,
    format: 'markdown',
  };
}
