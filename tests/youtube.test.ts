// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  checkPlayability,
  extractInnertubeApiKey,
  extractPlayerResponse,
  extractVideoId,
  isYouTubeWatchUrl,
  parseJson3Transcript,
  parseTimedTextXml,
  stripFmtParam,
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

describe('extractInnertubeApiKey', () => {
  it('从 HTML 正则提取', () => {
    const html = 'ytcfg.set({"INNERTUBE_API_KEY":"AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8","x":1});';
    expect(extractInnertubeApiKey(html)).toBe('AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8');
  });
  it('无 key 返回 null', () => {
    expect(extractInnertubeApiKey('<html></html>')).toBeNull();
  });
});

describe('stripFmtParam', () => {
  it('剥掉内嵌 fmt 参数并保住其余参数', () => {
    expect(stripFmtParam('https://x/tt?v=1&fmt=srv3&lang=zh')).toBe('https://x/tt?v=1&lang=zh');
    expect(stripFmtParam('https://x/tt?v=1&lang=zh&fmt=json3')).toBe('https://x/tt?v=1&lang=zh');
    expect(stripFmtParam('https://x/tt?v=1&lang=zh')).toBe('https://x/tt?v=1&lang=zh');
  });
});

describe('checkPlayability', () => {
  it('OK / 缺失状态 → 可播放', () => {
    expect(checkPlayability({ status: 'OK' })).toBeNull();
    expect(checkPlayability(null)).toBeNull();
    expect(checkPlayability({})).toBeNull();
  });
  it('风控 / 年龄限制 / 不可用映射为可读错误', () => {
    expect(checkPlayability({ status: 'LOGIN_REQUIRED', reason: 'Sign in to Confirm you’re not a bot' })).toContain('风控');
    expect(checkPlayability({ status: 'LOGIN_REQUIRED', reason: 'This video may be inappropriate for some users.' })).toContain('年龄限制');
    expect(checkPlayability({ status: 'ERROR', reason: 'This video is unavailable' })).toContain('不可用');
    expect(checkPlayability({ status: 'UNPLAYABLE', reason: 'xxx' })).toContain('xxx');
  });
});

describe('extractPlayerResponse', () => {
  it('括号配对解析嵌套 JSON（含字符串内的花括号与转义）', () => {
    const html =
      'var x = 1; var ytInitialPlayerResponse = ' +
      '{"videoDetails":{"title":"a\\"b {c}"},"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"u1"}]}}};\nvar y = 2;';
    const r = extractPlayerResponse(html);
    expect(r).not.toBeNull();
    const tracks = (
      r as unknown as {
        captions: { playerCaptionsTracklistRenderer: { captionTracks: unknown[] } };
      }
    ).captions.playerCaptionsTracklistRenderer.captionTracks;
    expect(tracks).toHaveLength(1);
  });
  it('无标记返回 null', () => {
    expect(extractPlayerResponse('<html>nothing</html>')).toBeNull();
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
