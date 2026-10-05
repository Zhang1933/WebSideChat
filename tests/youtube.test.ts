// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  extractVideoId,
  isYouTubeWatchUrl,
  parseJson3Transcript,
  parseTimedTextXml,
} from '@/lib/youtube';

describe('isYouTubeWatchUrl', () => {
  it('识别 watch / shorts / 移动端域名', () => {
    expect(isYouTubeWatchUrl('https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(isYouTubeWatchUrl('https://m.youtube.com/watch?v=abc&t=10')).toBe(true);
    expect(isYouTubeWatchUrl('https://www.youtube.com/shorts/xyz')).toBe(true);
  });
  it('非观看页与其他域名不识别', () => {
    expect(isYouTubeWatchUrl('https://www.youtube.com/')).toBe(false);
    expect(isYouTubeWatchUrl('https://www.youtube.com/feed/subscriptions')).toBe(false);
    expect(isYouTubeWatchUrl('https://example.com/watch?v=abc')).toBe(false);
    expect(isYouTubeWatchUrl('not-a-url')).toBe(false);
  });
});

describe('extractVideoId', () => {
  it('从 watch / shorts URL 提取视频 ID', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=izLekqHEYsE&t=5')).toBe('izLekqHEYsE');
    expect(extractVideoId('https://youtube.com/shorts/abc123XYZ_-')).toBe('abc123XYZ_-');
  });
  it('非视频页返回 null', () => {
    expect(extractVideoId('https://www.youtube.com/')).toBeNull();
    expect(extractVideoId('bad')).toBeNull();
  });
});

describe('parseJson3Transcript', () => {
  it('按事件拼行并带 [分:秒] 时间戳', () => {
    const json = {
      events: [
        { tStartMs: 0, segs: [{ utf8: 'hello ' }, { utf8: 'world' }] },
        { tStartMs: 65_000, segs: [{ utf8: '第二句' }] },
        { tStartMs: 3_725_000, segs: [{ utf8: '一小时后' }] },
      ],
    };
    expect(parseJson3Transcript(json)).toBe(
      '[00:00:00] hello world\n[00:01:05] 第二句\n[01:02:05] 一小时后',
    );
  });
  it('跳过空行与缺失 segs 的事件，折叠空白', () => {
    const json = {
      events: [
        { tStartMs: 0, segs: [{ utf8: '  \n ' }] },
        { tStartMs: 5_000 },
        { tStartMs: 10_000, segs: [{ utf8: 'a\n\nb' }] },
      ],
    };
    expect(parseJson3Transcript(json)).toBe('[00:00:10] a b');
  });
  it('非 json3 结构返回空串', () => {
    expect(parseJson3Transcript({})).toBe('');
    expect(parseJson3Transcript(null)).toBe('');
  });
});

describe('parseTimedTextXml', () => {
  it('解析默认 XML 字幕（start 秒 + 实体解码）', () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8" ?><transcript><text start="0" dur="1.5">hello &amp; world</text><text start="65.2">第二句</text><text start="70"></text></transcript>';
    expect(parseTimedTextXml(xml)).toBe('[00:00:00] hello & world\n[00:01:05] 第二句');
  });
  it('非 transcript 结构或坏 XML 返回空串', () => {
    expect(parseTimedTextXml('<html></html>')).toBe('');
    expect(parseTimedTextXml('')).toBe('');
  });
});
