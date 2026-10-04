import { browser } from '#imports';
import { drawerOpenItem, drawerPinnedItem, type DrawerMessage } from '@/lib/drawerMessages';
import { persistConversation } from '@/lib/storage';
import type { TurnMessage } from '@/lib/turnMessages';

const OFFSCREEN_URL = '/offscreen.html';

// 并发去重：多个面板同时 ensure 时只创建一次
let ensuring: Promise<void> | null = null;

/** 确保 Offscreen Document 存在（LLM 回合引擎的宿主），幂等 */
function ensureOffscreen(): Promise<void> {
  ensuring ??= (async () => {
    try {
      const existing = await browser.offscreen.hasDocument();
      if (!existing) {
        await browser.offscreen.createDocument({
          url: browser.runtime.getURL(OFFSCREEN_URL),
          // WORKERS：由常驻后台文档承载长时流式网络请求（SSE），避免 SW idle 回收中断
          reasons: ['WORKERS'],
          justification: '承载长时 LLM 流式请求，Service Worker 会被 idle 回收中断',
        });
      }
    } catch (err) {
      console.error('[WebChat] create offscreen failed:', err);
    } finally {
      ensuring = null;
    }
  })();
  return ensuring;
}

export default defineBackground(() => {
  // 已注册抽屉 content script 的标签页（图标点击分流用；消息路径无需用户手势）
  const drawerTabs = new Set<number>();

  // 工具栏图标：优先切换当前页的注入式抽屉（标签独立）；
  // 不可注入页（chrome://、商店页、未刷新的旧页面）回退为打开原生侧边栏——
  // 关键：sidePanel.open 必须在点击事件的同步段内调用，任何 await 都会丢用户手势。
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch((err) => console.error('[WebChat] setPanelBehavior failed:', err));

  browser.action.onClicked.addListener((tab) => {
    const tabId = tab.id;
    if (tabId == null) return;
    if (drawerTabs.has(tabId)) {
      void browser.tabs
        .sendMessage(tabId, { type: 'drawer:toggle' } satisfies DrawerMessage)
        .catch(() => {
          drawerTabs.delete(tabId); // 脚本已失效（导航去了不可注入页）
        });
    } else {
      // 同步调用保住手势
      void browser.sidePanel.open({ tabId }).catch((err) =>
        console.error('[WebChat] open panel failed:', err),
      );
    }
  });

  browser.runtime.onMessage.addListener((msg: DrawerMessage | TurnMessage, sender) => {
    // ---- 抽屉状态协议 ----
    if (msg?.type === 'drawer:hello') {
      const tabId = sender.tab?.id;
      if (tabId != null) drawerTabs.add(tabId);
    } else if (msg?.type === 'drawer:get-state') {
      const tabId = sender.tab?.id;
      if (tabId == null) return Promise.resolve({ open: false });
      return Promise.all([drawerOpenItem(tabId).getValue(), drawerPinnedItem.getValue()]).then(
        ([open, pinned]) => ({ open, pinned }),
      );
    }
    if (msg?.type === 'drawer:set-open') {
      const tabId = sender.tab?.id;
      if (tabId != null) void drawerOpenItem(tabId).setValue(msg.open);
    } else if (msg?.type === 'drawer:set-pinned') {
      void drawerPinnedItem.setValue(msg.pinned);
    } else if (
      msg?.type === 'turn:started' ||
      msg?.type === 'turn:done' ||
      msg?.type === 'turn:error'
    ) {
      // offscreen 文档没有 chrome.storage：由本监听器代为持久化（事件唤醒 SW）
      void persistConversation(msg.conversation);
    } else if (msg?.type === 'offscreen:ensure') {
      // 面板发起回合前请求确保宿主就绪；返回 promise 即响应
      return ensureOffscreen();
    } else if (msg?.type === 'offscreen:idle') {
      // offscreen 空闲 2 分钟：关闭省内存，下次请求时重建
      void browser.offscreen.closeDocument().catch(() => {
        /* 可能已关闭，忽略 */
      });
    }
  });

  // pin 开启时：新建标签页自动展开抽屉（content script 加载时读取）
  browser.tabs.onCreated.addListener((tab) => {
    if (tab.id == null) return;
    void drawerPinnedItem.getValue().then((pinned) => {
      if (pinned) void drawerOpenItem(tab.id!).setValue(true);
    });
  });

  // 标签页关闭：清理本 tab 的抽屉状态与脚本注册
  browser.tabs.onRemoved.addListener((tabId) => {
    drawerTabs.delete(tabId);
    void drawerOpenItem(tabId).removeValue();
  });
});
