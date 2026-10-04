// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { convertHtmlToMarkdown } from '@/lib/markdown';

describe('convertHtmlToMarkdown', () => {
  it('标题转 atx 格式，列表转 bullet', () => {
    const md = convertHtmlToMarkdown('<h1>标题</h1><h3>小节</h3><ul><li>a</li><li>b</li></ul>');
    expect(md).toContain('# 标题');
    expect(md).toContain('### 小节');
    expect(md).toMatch(/-\s+a/);
    expect(md).toMatch(/-\s+b/);
  });

  it('表格转 GFM 管道格式', () => {
    const md = convertHtmlToMarkdown(
      '<table><tr><th>参数</th><th>说明</th></tr><tr><td>q</td><td>查询词</td></tr></table>',
    );
    expect(md).toContain('| 参数 |');
    expect(md).toContain('| q |');
  });

  it('相对链接基于页面 URL 绝对化', () => {
    const md = convertHtmlToMarkdown('<a href="/docs/x">文档</a>', 'https://example.com/guide/page');
    expect(md).toContain('[文档](https://example.com/docs/x)');
  });

  it('锚点链接只保留文字', () => {
    const md = convertHtmlToMarkdown('<a href="#section">跳转</a>');
    expect(md.trim()).toBe('跳转');
  });

  it('script/style 内容被剔除', () => {
    const md = convertHtmlToMarkdown(
      '<script>window.x=1</script><style>.a{color:red}</style><p>正文</p>',
    );
    expect(md).toContain('正文');
    expect(md).not.toContain('window.x');
    expect(md).not.toContain('color:red');
  });

  it('图片转为 alt 文本占位', () => {
    const md = convertHtmlToMarkdown('<p>架构<img src="/x.png" alt="系统架构图">说明</p>');
    expect(md).toContain('[图片：系统架构图]');
    expect(md).not.toContain('x.png');
  });

  it('代码块转 fenced', () => {
    const md = convertHtmlToMarkdown('<pre><code>const a = 1</code></pre>');
    expect(md).toContain('```');
    expect(md).toContain('const a = 1');
  });

  it('接受 Element 输入（就地剔除噪声）', () => {
    const div = document.createElement('div');
    div.innerHTML = '<script>bad()</script><h2>标题X</h2>';
    const md = convertHtmlToMarkdown(div);
    expect(md).toContain('## 标题X');
    expect(md).not.toContain('bad()');
  });
});
