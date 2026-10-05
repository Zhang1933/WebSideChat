import { describe, expect, it } from 'vitest';
import {
  extractWbiKey,
  getMixinKey,
  isBilibiliVideoUrl,
  md5,
  parseBilibiliSubtitle,
  pickBilibiliSubtitle,
  signWbiParams,
} from '@/lib/bilibili';
import { expandTimestampLinks, isVideoPageUrl, timestampUrl } from '@/lib/video/pages';

describe('isBilibiliVideoUrl', () => {
  it('识别 /video/ 页（www. / m.）', () => {
    expect(isBilibiliVideoUrl('https://www.bilibili.com/video/BV1xx411c7mD')).toBe(true);
    expect(isBilibiliVideoUrl('https://www.bilibili.com/video/BV1xx411c7mD?p=2&t=10')).toBe(true);
    expect(isBilibiliVideoUrl('https://m.bilibili.com/video/BV1xx411c7mD')).toBe(true);
  });
  it('非视频页返回 false（动态 / 番剧 / 首页 / 其他域名）', () => {
    expect(isBilibiliVideoUrl('https://www.bilibili.com/opus/123')).toBe(false);
    expect(isBilibiliVideoUrl('https://www.bilibili.com/bangumi/play/ep123')).toBe(false);
    expect(isBilibiliVideoUrl('https://www.bilibili.com/')).toBe(false);
    expect(isBilibiliVideoUrl('https://www.youtube.com/watch?v=abc')).toBe(false);
    expect(isBilibiliVideoUrl('not-a-url')).toBe(false);
  });
});

describe('pickBilibiliSubtitle', () => {
  it('手动中文字幕（zh-CN/zh-Hans）优先于 AI 生成（ai-zh）', () => {
    const list = {
      subtitles: [
        { lan: 'ai-zh', subtitle_url: '//ai' },
        { lan: 'zh-CN', subtitle_url: '//manual' },
      ],
    };
    expect(pickBilibiliSubtitle(list)?.subtitle_url).toBe('//manual');
  });
  it('仅有 AI 中文字幕时选 AI', () => {
    const list = { subtitles: [{ lan: 'ai-zh', subtitle_url: '//ai' }] };
    expect(pickBilibiliSubtitle(list)?.subtitle_url).toBe('//ai');
  });
  it('忽略非中文字幕；兼容旧字段 list；无中文返回 null', () => {
    expect(pickBilibiliSubtitle({ subtitles: [{ lan: 'en', subtitle_url: '//en' }] })).toBeNull();
    expect(pickBilibiliSubtitle({ list: [{ lan: 'zh-Hans', subtitle_url: '//hans' }] })?.lan).toBe('zh-Hans');
    expect(pickBilibiliSubtitle({})).toBeNull();
  });
});

describe('parseBilibiliSubtitle', () => {
  it('body[].from 秒 → [HH:MM:SS] 带时间戳文本，跳过空行', () => {
    const json = {
      body: [
        { from: 0, to: 2.5, content: '大家好' },
        { from: 65.2, to: 68, content: '第二句 话' },
        { from: 3725, to: 3730, content: '一小时后' },
        { from: 4000, to: 4001, content: '   ' },
      ],
    };
    expect(parseBilibiliSubtitle(json)).toBe(
      '[00:00:00] 大家好\n[00:01:05] 第二句 话\n[01:02:05] 一小时后',
    );
  });
  it('缺 body 或非数组返回空串', () => {
    expect(parseBilibiliSubtitle({})).toBe('');
    expect(parseBilibiliSubtitle({ body: 'x' })).toBe('');
  });
});

describe('wbi 签名', () => {
  it('MD5 标准向量', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('hello')).toBe('5d41402abc4b2a76b9719d911017c592');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
  });
  it('mixin key 与官方文档示例一致', () => {
    // bilibili-API-collect 文档示例：img/sub key → mixin key
    expect(getMixinKey('7cd084941338484aae1ad9425b84077c', '4932caff0ff746eab6f01bf08b70ac45')).toBe(
      'ea1db124af3c7062474693fa704f4ff8',
    );
  });
  it('extractWbiKey 取文件名去扩展名', () => {
    expect(extractWbiKey('https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png')).toBe(
      '7cd084941338484aae1ad9425b84077c',
    );
  });
  it('signWbiParams：参数排序 + wts/w_rid，确定性输出', () => {
    const q = signWbiParams(
      { cid: 456, aid: 123 },
      'ea1db124af3c7062474693fa704f4ff8',
      1702204800,
    );
    expect(q).toMatch(/^aid=123&cid=456&wts=1702204800&w_rid=[0-9a-f]{32}$/);
    // 同输入同输出
    expect(signWbiParams({ cid: 456, aid: 123 }, 'ea1db124af3c7062474693fa704f4ff8', 1702204800)).toBe(q);
  });
});

describe('isVideoPageUrl / timestampLinkTemplate', () => {
  it('YouTube 与 B 站视频页都算视频页', () => {
    expect(isVideoPageUrl('https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(isVideoPageUrl('https://www.bilibili.com/video/BV1xx411c7mD')).toBe(true);
    expect(isVideoPageUrl('https://example.com/post/1')).toBe(false);
    expect(isVideoPageUrl(undefined)).toBe(false);
  });
  it('timestampUrl：按站点生成完整跳转 URL（YouTube 带 s；B 站剥追踪参数、保留分 P）', () => {
    expect(timestampUrl('https://www.youtube.com/watch?v=abc&list=1', 330)).toBe(
      'https://www.youtube.com/watch?v=abc&t=330s',
    );
    expect(timestampUrl('https://www.bilibili.com/video/BV1xx?p=3&vd_source=abc', 330)).toBe(
      'https://www.bilibili.com/video/BV1xx?p=3&t=330',
    );
    expect(timestampUrl('https://example.com/a', 330)).toBeNull();
  });
  it('expandTimestampLinks：#t 占位展开为完整链接；非时间文字与无视频 URL 原样保留', () => {
    const raw = '- 要点 [`05:30`](#t) 与 [`01:02:05`](#t)\n- 普通链接 [官网](https://example.com) 与无效 [`x`](#t)';
    expect(expandTimestampLinks(raw, 'https://www.bilibili.com/video/BV1xx')).toBe(
      '- 要点 [`05:30`](https://www.bilibili.com/video/BV1xx?t=330) 与 [`01:02:05`](https://www.bilibili.com/video/BV1xx?t=3725)\n- 普通链接 [官网](https://example.com) 与无效 [`x`](#t)',
    );
    expect(expandTimestampLinks(raw, null)).toBe(raw);
  });
});
