import { describe, expect, it } from 'vitest';
import {
  MAX_CONVERSATIONS,
  pruneConversations,
  visibleStartIndex,
  withMessage,
} from '@/lib/conversation';
import { DEFAULT_SUMMARY_PROMPTS } from '@/lib/prompts';
import {
  contentBudgetChars,
  effectiveContextLimit,
  pageKeyOf,
  parseContextInput,
  parseContextSuffix,
  stripContextSuffix,
  truncateContent,
} from '@/lib/utils';
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

describe('visibleStartIndex', () => {
  it('summaryPrompt 匹配的首条指令消息被隐藏', () => {
    const c: Conversation = {
      ...conv('a', 1),
      summaryPrompt: '总结指令',
      messages: [
        { role: 'user', content: '总结指令' },
        { role: 'assistant', content: '摘要' },
      ],
    };
    expect(visibleStartIndex(c)).toBe(1);
  });

  it('无 summaryPrompt 时按内置默认摘要指令识别（兼容旧会话）', () => {
    const c: Conversation = {
      ...conv('a', 1),
      messages: [
        { role: 'user', content: DEFAULT_SUMMARY_PROMPTS.zh },
        { role: 'assistant', content: '摘要' },
      ],
    };
    expect(visibleStartIndex(c)).toBe(1);
  });

  it('首轮直接提问的会话全量展示', () => {
    const c: Conversation = {
      ...conv('a', 1),
      messages: [
        { role: 'user', content: '这个页面讲了什么？' },
        { role: 'assistant', content: '回答' },
      ],
    };
    expect(visibleStartIndex(c)).toBe(0);
  });

  it('空会话返回 0', () => {
    expect(visibleStartIndex(conv('a', 1))).toBe(0);
  });
});

describe('effectiveContextLimit', () => {
  it('未配置时普通模型取默认 128,000 token', () => {
    expect(effectiveContextLimit({ model: 'deepseek-chat' })).toBe(128_000);
  });
  it('模型名长度后缀推导（[1m] / [128k]）', () => {
    expect(effectiveContextLimit({ model: 'kimi-k2[1m]' })).toBe(1_000_000);
    expect(effectiveContextLimit({ model: 'glm-5[1M] ' })).toBe(1_000_000);
    expect(effectiveContextLimit({ model: 'm[128k]' })).toBe(128_000);
  });
  it('显式配置优先于自动推导', () => {
    expect(effectiveContextLimit({ model: 'm[1m]', contextLimit: 64_000 })).toBe(64_000);
  });
});

describe('parseContextSuffix / stripContextSuffix', () => {
  it('解析常见长度后缀', () => {
    expect(parseContextSuffix('glm-5.3[1m]')).toEqual({ limit: 1_000_000, baseModel: 'glm-5.3' });
    expect(parseContextSuffix('m[128k]')).toEqual({ limit: 128_000, baseModel: 'm' });
    expect(parseContextSuffix('m[2M]')).toEqual({ limit: 2_000_000, baseModel: 'm' });
    expect(parseContextSuffix('m[2000000]')).toEqual({ limit: 2_000_000, baseModel: 'm' });
    expect(parseContextSuffix(' glm-5.3[1m] ')).toEqual({ limit: 1_000_000, baseModel: 'glm-5.3' });
  });
  it('非长度后缀 / 过小数值不识别', () => {
    expect(parseContextSuffix('m[beta]')).toBeNull();
    expect(parseContextSuffix('m[16]')).toBeNull();
    expect(parseContextSuffix('deepseek-chat')).toBeNull();
  });
  it('strip 剥离长度后缀，保留非长度后缀', () => {
    expect(stripContextSuffix('glm-5.3[1m]')).toBe('glm-5.3');
    expect(stripContextSuffix('m[128k]')).toBe('m');
    expect(stripContextSuffix('m[beta]')).toBe('m[beta]');
    expect(stripContextSuffix('deepseek-chat')).toBe('deepseek-chat');
  });
});

describe('parseContextInput', () => {
  it('解析 1m/128k/纯数字/小数单位', () => {
    expect(parseContextInput('1m')).toBe(1_000_000);
    expect(parseContextInput('128k')).toBe(128_000);
    expect(parseContextInput('1M')).toBe(1_000_000);
    expect(parseContextInput('0.5m')).toBe(500_000);
    expect(parseContextInput('2000000')).toBe(2_000_000);
    expect(parseContextInput(' 64K ')).toBe(64_000);
  });
  it('无法解析返回 null', () => {
    expect(parseContextInput('')).toBeNull();
    expect(parseContextInput('abc')).toBeNull();
    expect(parseContextInput('1x')).toBeNull();
    expect(parseContextInput('-5')).toBeNull();
    expect(parseContextInput('1m 2k')).toBeNull();
  });
});

describe('contentBudgetChars', () => {
  it('默认 128k 上下文 → 上下文 × 0.8 折算字符', () => {
    // 128_000 * 0.8 * 1.7 = 174,080
    expect(contentBudgetChars({ model: 'deepseek-chat' })).toBe(174_080);
  });
  it('[1m] 模型放大预算（clamp 到 100 万字符）', () => {
    expect(contentBudgetChars({ model: 'kimi[1m]' })).toBe(1_000_000);
  });
  it('预算有上下限 clamp', () => {
    expect(contentBudgetChars({ model: 'm', contextLimit: 8_000 })).toBeGreaterThanOrEqual(4_000);
    expect(contentBudgetChars({ model: 'm', contextLimit: 10_000_000 })).toBeLessThanOrEqual(1_000_000);
  });
});
