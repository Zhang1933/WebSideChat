import { describe, expect, it } from 'vitest';
import { MAX_CONVERSATIONS, pruneConversations, withMessage } from '@/lib/conversation';
import { pageKeyOf, truncateContent } from '@/lib/utils';
import type { Conversation } from '@/types';

function conv(pageKey: string, updatedAt: number): Conversation {
  return {
    pageKey,
    url: pageKey,
    title: pageKey,
    content: 'x',
    truncated: false,
    extractedAt: updatedAt,
    messages: [],
    updatedAt,
  };
}

describe('pageKeyOf', () => {
  it('去 hash', () => {
    expect(pageKeyOf('https://example.com/a#section')).toBe('https://example.com/a');
  });
  it('去 utm 跟踪参数但保留业务参数', () => {
    expect(pageKeyOf('https://example.com/p?id=1&utm_source=x&utm_medium=y')).toBe(
      'https://example.com/p?id=1',
    );
  });
  it('去 spm/from 等国内常见跟踪参数', () => {
    expect(pageKeyOf('https://example.com/p?spm=101&from=timeline&q=hi')).toBe(
      'https://example.com/p?q=hi',
    );
  });
  it('非法 URL 返回原文 trim', () => {
    expect(pageKeyOf('  not-a-url ')).toBe('not-a-url');
  });
});

describe('truncateContent', () => {
  it('不超长不截断', () => {
    const r = truncateContent('abc', 10);
    expect(r).toEqual({ text: 'abc', truncated: false });
  });
  it('超长截断并追加标记', () => {
    const r = truncateContent('a'.repeat(100), 10);
    expect(r.truncated).toBe(true);
    expect(r.text.startsWith('a'.repeat(10))).toBe(true);
    expect(r.text).toContain('已截断');
  });
});

describe('pruneConversations', () => {
  it('未超上限原样返回', () => {
    const input = { a: conv('a', 1), b: conv('b', 2) };
    expect(pruneConversations(input)).toBe(input);
  });
  it('超过上限按 updatedAt 保留最新 10 条', () => {
    const input: Record<string, Conversation> = {};
    for (let i = 0; i < 15; i++) input['k' + i] = conv('k' + i, i);
    const pruned = pruneConversations(input);
    expect(Object.keys(pruned)).toHaveLength(MAX_CONVERSATIONS);
    // k5..k14 被保留（最新），k0..k4 被淘汰
    expect(pruned['k14']).toBeDefined();
    expect(pruned['k5']).toBeDefined();
    expect(pruned['k4']).toBeUndefined();
  });
});

describe('withMessage', () => {
  it('追加消息并更新 updatedAt', async () => {
    const c = conv('a', 1);
    const next = withMessage(c, { role: 'user', content: 'hi' });
    expect(next.messages).toHaveLength(1);
    expect(next.updatedAt).toBeGreaterThanOrEqual(c.updatedAt);
  });
});
