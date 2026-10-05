import { describe, expect, it } from 'vitest';
import { getOriginPattern } from '@/lib/permissions';

describe('getOriginPattern', () => {
  it('提取 origin 并加通配（路径/查询参数剥离）', () => {
    expect(getOriginPattern('https://api.deepseek.com/v1/chat')).toBe('https://api.deepseek.com/*');
    expect(getOriginPattern('https://chatgpt.com/backend-api/codex?x=1')).toBe(
      'https://chatgpt.com/*',
    );
    expect(getOriginPattern('http://localhost:11434/v1')).toBe('http://localhost/*');
  });
  it('非法输入返回 null（非 URL / 非 http(s) 协议）', () => {
    expect(getOriginPattern('not-a-url')).toBeNull();
    expect(getOriginPattern('ftp://example.com/x')).toBeNull();
    expect(getOriginPattern('')).toBeNull();
  });
});
