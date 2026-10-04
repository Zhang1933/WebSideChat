import { describe, expect, it } from 'vitest';
import { compressThreshold, estimateConversationTokens, estimateTokens } from '@/lib/context';

describe('estimateTokens', () => {
  it('按 ~1.7 字符/token 向上取整', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(17))).toBe(10);
    expect(estimateTokens('你好')).toBe(2); // 2/1.7 → 1.18 → 2
  });
});

describe('estimateConversationTokens', () => {
  it('system 与消息内容求和，每条消息含固定开销', () => {
    const total = estimateConversationTokens('abcd', [
      { role: 'user', content: 'abcd' },
      { role: 'assistant', content: 'abcd' },
    ]);
    // system ceil(4/1.7)=3；每条消息 ceil(4/1.7)+4 = 7；3+7+7=17
    expect(total).toBe(17);
  });
});

describe('compressThreshold', () => {
  it('上下文减去输出预留与安全余量', () => {
    expect(compressThreshold(128_000)).toBe(128_000 - 4096 - 1024);
    expect(compressThreshold(128_000, 2048)).toBe(128_000 - 2048 - 1024);
  });
});
