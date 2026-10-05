import { storage } from '#imports';

/**
 * 工具栏图标点击（用户手势）时记录的 tabId → 页面 URL。
 * 用途：原生侧边栏未经手势打开时 tab.url 不可见（无 activeTab / host 权限），
 * 面板从这里取最近一次手势时的 URL，推算 origin 供「授权本站」按钮申请。
 * session 存储：随浏览器会话存活，权限变化后自然过期。
 */
export const gestureTabUrlsItem = storage.defineItem<Record<string, string>>(
  'session:gestureTabUrls',
  { fallback: {} },
);
