import { browser, storage } from '#imports';
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
      console.error('[WebSideChat] create offscreen failed:', err);
    } finally {
      ensuring = null;
    }
  })();
  return ensuring;
}

export default defineBackground(() => {
  // 已注册抽屉 content script 的标签页（图标点击分流用；消息路径无需用户手势）
  const drawerTabs = new Set<number>();

  /** 侧边栏全局禁用状态（进入扩展配置页时置 true）。session 持久化：SW 重启后仍可对账恢复 */
  const panelDisabledItem = storage.defineItem<boolean>('session:panelDisabled', {
    fallback: false,
  });

  // 被我们禁用了原生侧边栏的标签页（本插件 options 页；离开时恢复）
  const panelDisabledTabs = new Set<number>();

  /** 是否为任意扩展的配置页（chrome-extension://<任何id>/options.html…） */
  function isAnyOptionsPage(url: string | undefined): boolean {
    if (!url) return false;
    try {
      const u = new URL(url);
      return u.protocol === 'chrome-extension:' && u.pathname.startsWith('/options.html');
    } catch {
      return false;
    }
  }

  /** 最近一次由我们 open({tabId}) 打开的面板所属标签页（close 只能关 tab 专属面板） */
  const lastPanelTabItem = storage.defineItem<number | null>('session:lastPanelTabId', {
    fallback: null,
  });

  /**
   * 收起侧边栏的三板斧（close 只能关"扩展自己 open() 打开的 tab 专属面板"，
   * 用户从浏览器 UI 打开的窗口级面板只能靠全局禁用让 Chrome 收起）：
   * ① close 当前标签页的面板绑定
   * ② close 我们此前 open() 打开的面板所属标签页（面板按标签绑定，切走后挂在原标签上）
   * ③ 全局 setOptions({enabled:false})：本扩展面板整体不可用 → Chrome 收起已打开的面板
   */
  function collapseSidePanel(tabId: number) {
    const closePanel = (
      browser.sidePanel as unknown as { close?: (o: { tabId: number }) => Promise<void> }
    ).close;
    closePanel
      ?.call(browser.sidePanel, { tabId })
      .catch((e) => console.warn('[WebSideChat bg] close(当前标签) 失败:', e?.message ?? e));
    void lastPanelTabItem.getValue().then((panelTab) => {
      if (panelTab != null && panelTab !== tabId) {
        closePanel
          ?.call(browser.sidePanel, { tabId: panelTab })
          .catch((e) => console.warn('[WebSideChat bg] close(面板所属标签) 失败:', e?.message ?? e));
      }
    });
    void browser.sidePanel
      .setOptions({ enabled: false })
      .catch((e) => console.warn('[WebSideChat bg] 全局禁用失败:', e));
  }

  function restoreSidePanel() {
    // 路径与 manifest 的 default_path 完全一致
    void browser.sidePanel
      .setOptions({ enabled: true, path: 'sidepanel.html' })
      .catch((e) => console.warn('[WebSideChat bg] 全局恢复失败:', e));
  }

  /**
   * 全局禁用/恢复按"当前激活页是否为扩展配置页"驱动（禁用是全局的，
   * 恢复条件必须是任意非配置页激活，而不是回到当初那个标签页）。
   */
  async function syncSidePanelForTab(tabId: number, url: string | undefined) {
    const isOptions = isAnyOptionsPage(url);
    const disabled = await panelDisabledItem.getValue();
    if (isOptions && !disabled) {
      await panelDisabledItem.setValue(true);
      console.log('[WebSideChat bg] 检测到扩展配置页，收起侧边栏:', { tabId, url });
      collapseSidePanel(tabId);
    } else if (!isOptions && disabled) {
      await panelDisabledItem.setValue(false);
      restoreSidePanel();
    }
  }

  // SW 冷启动对账：若上次禁用后 SW 被回收，而当前激活页已不是配置页 → 恢复
  browser.tabs
    .query({ active: true, currentWindow: true })
    .then(([t]) => {
      if (t?.id != null) void syncSidePanelForTab(t.id, t.url);
    })
    .catch(() => {});

  browser.tabs.onActivated.addListener(({ tabId }) => {
    void browser.tabs
      .get(tabId)
      .then((t) => syncSidePanelForTab(tabId, t.url))
      .catch(() => {});
  });
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // complete 时机 URL 稳定；tabs 权限下任意页面 URL 可见
    if (changeInfo.status === 'complete') void syncSidePanelForTab(tabId, tab.url);
  });

  // 工具栏图标：优先切换当前页的注入式抽屉（标签独立）；
  // 不可注入页（chrome://、商店页、未刷新的旧页面）回退为打开原生侧边栏——
  // 关键：sidePanel.open 必须在点击事件的同步段内调用，任何 await 都会丢用户手势。
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch((err) => console.error('[WebSideChat] setPanelBehavior failed:', err));

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
      // 同步调用保住手势；成功后记住面板所属标签（供配置页收起时定向 close）
      void browser.sidePanel
        .open({ tabId })
        .then(() => lastPanelTabItem.setValue(tabId))
        .catch((err) => console.error('[WebSideChat] open panel failed:', err));
    }
  });

  browser.runtime.onMessage.addListener((msg: DrawerMessage | TurnMessage, sender) => {
    // ---- 抽屉状态协议 ----
    if (msg?.type === 'drawer:hello') {
      const tabId = sender.tab?.id;
      if (tabId != null) drawerTabs.add(tabId);
      // 返回 tabId：content script 用它 watch 本 tab 的抽屉状态存储项
      return Promise.resolve(tabId);
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
    } else if (
      msg?.type === 'turn:started' ||
      msg?.type === 'turn:done' ||
      msg?.type === 'turn:error'
    ) {
      // offscreen 文档没有 chrome.storage：由本监听器代为持久化（事件唤醒 SW）
      console.log('[WebSideChat bg]', msg.type, msg.pageKey, msg.type === 'turn:error' ? msg.error : '');
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
