/**
 * 运行时域名权限（optional_host_permissions）的工具封装。
 * 注意：permissions.request 必须在用户手势（点击事件）的调用链前段触发，
 * 否则 Chrome 拒绝弹窗——所有调用点都挂在按钮 handler 里。
 */

/** 全域模式（pin 固定抽屉跨站自动展开时一次性申请） */
export const ALL_URLS_PATTERN = '<all_urls>';

/** ChatGPT 网页登录涉及的域（授权页 + 后端 API + 令牌刷新） */
export const OAUTH_ORIGIN_PATTERNS = ['https://chatgpt.com/*', 'https://auth.openai.com/*'];

/**
 * 从任意 URL 提取 origin 匹配规则：
 * https://api.deepseek.com/v1/chat → https://api.deepseek.com/*
 * 端口被剥离（match pattern 不支持端口，hostname 本身不含端口，localhost:11434 天然兼容）。
 */
export function getOriginPattern(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (!/^https?:$/.test(u.protocol)) return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

/** 是否已拥有该域名的 host 权限 */
export async function hasHostPermission(pattern: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

/**
 * 申请单个域名权限（已拥有则静默通过）。
 * 非手势上下文调用会抛错/失败 → 返回 false，调用方负责给出「点击 xx 按钮授权」的提示。
 */
export async function requestHostPermission(pattern: string): Promise<boolean> {
  if (await hasHostPermission(pattern)) return true;
  try {
    return (await browser.permissions.request({ origins: [pattern] })) ?? false;
  } catch (err) {
    console.error('[WebSideChat] request host permission failed:', err);
    return false;
  }
}

/** 批量申请缺失的域名权限（一次手势弹一个气泡，含全部 origins） */
export async function requestHostPermissions(patterns: string[]): Promise<boolean> {
  const missing: string[] = [];
  for (const p of new Set(patterns)) {
    if (!(await hasHostPermission(p))) missing.push(p);
  }
  if (missing.length === 0) return true;
  try {
    return (await browser.permissions.request({ origins: missing })) ?? false;
  } catch (err) {
    console.error('[WebSideChat] request host permissions failed:', err);
    return false;
  }
}
