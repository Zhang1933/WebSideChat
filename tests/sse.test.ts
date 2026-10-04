import { describe, expect, it } from 'vitest';
import { anthropicAdapter } from '@/lib/llm/anthropic';
import { openaiChatAdapter } from '@/lib/llm/openai-chat';
import { SseParser } from '@/lib/llm/sse';

describe('SseParser', () => {
  it('解析单帧 data 事件', () => {
    const p = new SseParser();
    const evs = p.feed('data: {"a":1}\n\n');
    expect(evs).toEqual([{ event: undefined, data: '{"a":1}' }]);
  });

  it('单次 feed 多帧', () => {
    const p = new SseParser();
    const evs = p.feed('data: 1\n\ndata: 2\n\n');
    expect(evs.map((e) => e.data)).toEqual(['1', '2']);
  });

  it('跨 chunk 断裂的帧正确拼接', () => {
    const p = new SseParser();
    expect(p.feed('data: {"choices":[{"del')).toEqual([]);
    expect(p.feed('ta":{"content":"你好"}}]}\n')).toEqual([]);
    const evs = p.feed('\n');
    expect(evs).toHaveLength(1);
    expect(JSON.parse(evs[0]!.data).choices[0].delta.content).toBe('你好');
  });

  it('保留 event 行名（anthropic 需要）', () => {
    const p = new SseParser();
    const evs = p.feed('event: content_block_delta\ndata: {"delta":{"text":"hi"}}\n\n');
    expect(evs[0]!.event).toBe('content_block_delta');
  });

  it('忽略注释/心跳行', () => {
    const p = new SseParser();
    const evs = p.feed(': keep-alive\n\ndata: x\n\n');
    expect(evs).toHaveLength(1);
    expect(evs[0]!.data).toBe('x');
  });

  it('data 值含冒号不被截断', () => {
    const p = new SseParser();
    const evs = p.feed('data: {"json":"with:colon"}\n\n');
    expect(evs[0]!.data).toBe('{"json":"with:colon"}');
  });

  it('CRLF 换行正确分帧', () => {
    const p = new SseParser();
    const evs = p.feed('data: a\r\n\r\ndata: b\r\n\r\n');
    expect(evs.map((e) => e.data)).toEqual(['a', 'b']);
  });

  it('无事件体的帧（纯 event 行）不产出', () => {
    const p = new SseParser();
    expect(p.feed('event: ping\n\n')).toEqual([]);
  });

  it('流结束时 flush 冲刷未收尾的残帧', () => {
    const p = new SseParser();
    expect(p.feed('data: tail')).toEqual([]);
    expect(p.flush().map((e) => e.data)).toEqual(['tail']);
  });
});

describe('openaiChatAdapter.extractDelta', () => {
  it('提取 delta.content', () => {
    const r = openaiChatAdapter.extractDelta({ data: '{"choices":[{"delta":{"content":"Hi"}}]}' });
    expect(r?.text).toBe('Hi');
    expect(r?.done).toBeFalsy();
  });

  it('[DONE] 结束', () => {
    const r = openaiChatAdapter.extractDelta({ data: '[DONE]' });
    expect(r?.done).toBe(true);
  });

  it('finish_reason 视为结束', () => {
    const r = openaiChatAdapter.extractDelta({
      data: '{"choices":[{"delta":{},"finish_reason":"stop"}]}',
    });
    expect(r?.done).toBe(true);
  });

  it('reasoning_content 思维链被跳过', () => {
    const r = openaiChatAdapter.extractDelta({
      data: '{"choices":[{"delta":{"reasoning_content":"思考中"}}]}',
    });
    expect(r?.text).toBe('');
  });

  it('非 JSON 帧返回 null 不抛错', () => {
    expect(openaiChatAdapter.extractDelta({ data: 'not json' })).toBeNull();
  });

  it('extractFull 提取 message.content', () => {
    expect(openaiChatAdapter.extractFull({ choices: [{ message: { content: 'full' } }] })).toBe(
      'full',
    );
  });
});

describe('anthropicAdapter.extractDelta', () => {
  it('content_block_delta 提取 text_delta', () => {
    const r = anthropicAdapter.extractDelta({
      event: 'content_block_delta',
      data: '{"delta":{"type":"text_delta","text":"你好"}}',
    });
    expect(r?.text).toBe('你好');
  });

  it('thinking_delta 被跳过', () => {
    const r = anthropicAdapter.extractDelta({
      event: 'content_block_delta',
      data: '{"delta":{"type":"thinking_delta","thinking":"..."}}',
    });
    expect(r).toBeNull();
  });

  it('message_stop 结束', () => {
    const r = anthropicAdapter.extractDelta({ event: 'message_stop', data: '{}' });
    expect(r?.done).toBe(true);
  });

  it('error 事件转为 provider 错误', () => {
    const r = anthropicAdapter.extractDelta({
      event: 'error',
      data: '{"error":{"message":"credit too low"}}',
    });
    expect(r?.error?.message).toContain('credit too low');
  });

  it('extractFull 拼接 text 块', () => {
    expect(
      anthropicAdapter.extractFull({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }),
    ).toBe('ab');
  });
});
