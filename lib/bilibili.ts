/** B 站字幕提取的纯函数（单测覆盖；网络请求在 sidepanel 扩展上下文发出） */

/** x/player/v2 响应 data.subtitle 的形状（新旧字段 list / subtitles 都兼容） */
export interface BiliSubtitleEntry {
  /** 语言代码：zh-CN / zh-Hans = 手动上传；ai-zh = AI 生成 */
  lan?: string;
  lan_doc?: string;
  /** 协议相对地址（//aisubtitle.hdslb.com/...）需补 https: 前缀 */
  subtitle_url?: string;
}

export interface BiliSubtitleList {
  subtitles?: BiliSubtitleEntry[];
  list?: BiliSubtitleEntry[];
  allow_submit?: boolean;
}

/** 是否为 B 站视频页（/video/BV...；www. / m. 都算；b23.tv 短链会先重定向到此处） */
export function isBilibiliVideoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/(^|\.)bilibili\.com$/.test(u.hostname.toLowerCase())) return false;
    return u.pathname.startsWith('/video/');
  } catch {
    return false;
  }
}

/**
 * 从字幕列表选中文字幕：手动上传（zh-CN/zh-Hans）优先于 AI 生成（ai-zh），
 * 非中文轨道（en/ja/ko 等）不选。中文判定覆盖两种命名：前缀 zh-CN 与后缀 ai-zh。
 */
export function pickBilibiliSubtitle(list: BiliSubtitleList): BiliSubtitleEntry | null {
  const entries = [...(list.subtitles ?? []), ...(list.list ?? [])];
  const chinese = entries.filter((s) => /(^|-)zh/i.test(s.lan ?? ''));
  return chinese.find((s) => !/^ai-/i.test(s.lan ?? '')) ?? chinese[0] ?? null;
}

/** aisubtitle CDN 的字幕 JSON（body[].from 秒 / content 文本）→ [HH:MM:SS] 一行的带时间戳文本 */
export function parseBilibiliSubtitle(json: unknown): string {
  const body = (json as { body?: { from?: number; content?: string }[] })?.body;
  if (!Array.isArray(body)) return '';
  const lines: string[] = [];
  for (const item of body) {
    const text = (item?.content ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const totalSec = Math.floor(Number(item.from) || 0);
    const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    lines.push(`[${h}:${m}:${s}] ${text}`);
  }
  return lines.join('\n');
}

// ---- wbi 签名（x/player/wbi/v2 需要；纯静态哈希，可本地计算） ----

/** MD5（wbi 签名用；crypto.subtle 不支持 MD5，内嵌实现） */
export function md5(str: string): string {
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);

  const bytes = new TextEncoder().encode(str);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, bitLen >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(bitLen / 2 ** 32), true);

  const rotl = (n: number, c: number) => (n << c) | (n >>> (32 - c));
  const add = (x: number, y: number) => (x + y) | 0;
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = add(add(add(F, A), K[i]!), M[g]!);
      A = D;
      D = C;
      C = B;
      B = add(B, rotl(F, S[i]!));
    }
    a0 = add(a0, A);
    b0 = add(b0, B);
    c0 = add(c0, C);
    d0 = add(d0, D);
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true);
  odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true);
  odv.setUint32(12, d0, true);
  return Array.from(out, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** wbi 官方混淆表（bilibili-API-collect，取前 32 位） */
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

/** nav 返回的 img_key + sub_key → 32 位 mixin key */
export function getMixinKey(imgKey: string, subKey: string): string {
  const raw = imgKey + subKey;
  return MIXIN_KEY_ENC_TAB.slice(0, 32)
    .map((i) => raw[i])
    .join('');
}

/** 从 nav 的 wbi_img URL（//i0.hdslb.com/bfs/wbi/7cd08494...png）提取 key（文件名去扩展名） */
export function extractWbiKey(url: string): string {
  const name = url.slice(url.lastIndexOf('/') + 1);
  return name.slice(0, name.lastIndexOf('.'));
}

/**
 * wbi 签名：参数按 key 排序 + wts，值过滤 !'()* 字符，
 * w_rid = md5(query + mixin_key)。返回补好 wts/w_rid 的完整 query 串。
 */
export function signWbiParams(
  params: Record<string, string | number>,
  mixinKey: string,
  wts: number = Math.floor(Date.now() / 1000),
): string {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    cleaned[k] = String(v).replace(/[!'()*]/g, '');
  }
  cleaned.wts = String(wts);
  const query = Object.keys(cleaned)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(cleaned[k] ?? '')}`)
    .join('&');
  return `${query}&w_rid=${md5(query + mixinKey)}`;
}
