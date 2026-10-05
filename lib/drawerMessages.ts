import { storage } from '#imports';

/**
 * 标签独立抽屉（iframe 注入式侧边栏）的状态与消息协议。
 * 可见性按 tabId 存 storage.session（导航后由 content script 恢复）；
 * pin 为全局开关：开启后新建标签页自动展开抽屉。
 */

export const DRAWER_WIDTH = 400;

/** 抽屉宽度（像素，全局持久化；左缘拖拽调整） */
export const drawerWidthItem = storage.defineItem<number>('local:drawerWidth', {
  fallback: DRAWER_WIDTH,
  version: 1,
});

/** 全局 pin：开启后新标签页自动展开抽屉 */
export const drawerPinnedItem = storage.defineItem<boolean>('session:drawerPinned', {
  fallback: false,
  version: 1,
});

/** 指定标签页的抽屉展开状态 */
export function drawerOpenItem(tabId: number) {
  return storage.defineItem<boolean>(`session:drawerOpen:${tabId}`, {
    fallback: false,
    version: 1,
  });
}

export type DrawerMessage =
  /** content script → background：注册本 tab 存在抽屉脚本（图标点击分流用） */
  | { type: 'drawer:hello' }
  /** content script → background：查询本 tab 的抽屉状态 */
  | { type: 'drawer:get-state' }
  /** content script → background：记录本 tab 抽屉开关 */
  | { type: 'drawer:set-open'; open: boolean }
  /** 抽屉内 iframe（扩展页）→ background：切换全局 pin */
  | { type: 'drawer:set-pinned'; pinned: boolean }
  /** background → content script：工具栏图标点击切换抽屉 */
  | { type: 'drawer:toggle' }
  /** background → content script 的应答/推送 */
  | { type: 'drawer:state'; open: boolean; pinned: boolean };

/** iframe → content script 的 postMessage（跨上下文，不走 runtime） */
export interface DrawerPostMessage {
  type: 'websidechat-drawer';
  action: 'close';
}
