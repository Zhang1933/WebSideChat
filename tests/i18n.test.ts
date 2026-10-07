import { describe, expect, it } from 'vitest';
import { setUiLang, t } from '@/lib/i18n';

describe('i18n t()', () => {
  it('按当前语言取词条，{n} 参数替换', () => {
    setUiLang('zh');
    expect(t('app.extractFail', '网络错误')).toBe('提取失败：网络错误');
    setUiLang('en');
    expect(t('app.extractFail', 'network')).toBe('Extraction failed: network');
    expect(t('pagebar.extracted', '1,234')).toBe('1,234 chars extracted');
  });
  it('未知 key 原样返回（开发期漏翻可见）', () => {
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });
  it('切换语言后重新取词生效', () => {
    setUiLang('en');
    expect(t('common.save')).toBe('Save');
    setUiLang('zh');
    expect(t('common.save')).toBe('保存');
  });
});
