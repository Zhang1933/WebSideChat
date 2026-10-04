import { storage } from '#imports';

/**
 * 已固定（启用面板）的标签页 ID 集合，存 storage.session：
 * 标签页本身随浏览器会话存亡，pin 状态也无需跨会话保留。
 * 固定发生在用户点击工具栏图标时（background 处理）；标签页关闭时由 background 清理。
 */
export const pinnedTabsItem = storage.defineItem<number[]>('session:pinnedTabs', {
  fallback: [],
  version: 1,
});
