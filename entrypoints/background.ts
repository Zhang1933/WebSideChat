import { storage } from '#imports';
import { pinnedTabsItem } from '@/lib/pinnedTabs';

const PANEL_PATH = '/sidepanel.html';

/** 每浏览器会话只做一次存量标签页初始化的标记（避免 SW 每次唤醒重跑，与点击处理竞态） */
const panelInitItem = storage.defineItem<boolean>('session:panelInit', { fallback: false });

/** 对指定标签页应用面板启用状态（enabled:false 时 Chrome 会在该页收起面板） */
function applyPanelOptions(tabId: number, enabled: boolean): Promise<void> {
  return browser.sidePanel
    .setOptions(enabled ? { tabId, path: PANEL_PATH, enabled: true } : { tabId, enabled: false })
    .catch((err) => {
      console.error('[AbstractWeb] setOptions failed:', err);
    });
}

async function applyPanelForTab(tabId: number): Promise<void> {
  const ids = await pinnedTabsItem.getValue();
  await applyPanelOptions(tabId, ids.includes(tabId));
}

export default defineBackground(() => {
  // 点击图标不由 Chrome 直接开面板（onClicked 里实现"固定 + 打开"）
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch((err) => console.error('[AbstractWeb] setPanelBehavior failed:', err));

  // 工具栏图标点击 = 固定该标签页并打开面板。
  // 关键约束：sidePanel.open() 必须在事件的同步执行段内调用——任何 await 都会丢用户手势
  // （实测一次 setOptions 的 await 即触发 "may only be called in response to a user gesture"）。
  // 因此 setOptions(启用) 与 open() 都同步派发（同一事件循环内按序处理），记账异步补。
  browser.action.onClicked.addListener((tab) => {
    const tabId = tab.id;
    if (tabId == null) return;
    browser.sidePanel
      .setOptions({ tabId, path: PANEL_PATH, enabled: true })
      .catch((err) => console.error('[AbstractWeb] setOptions failed:', err));
    browser.sidePanel
      .open({ tabId })
      .catch((err) => console.error('[AbstractWeb] open panel failed:', err));
    void (async () => {
      const ids = await pinnedTabsItem.getValue();
      if (!ids.includes(tabId)) await pinnedTabsItem.setValue([...ids, tabId]);
    })();
  });

  // pin 状态变化 → 应用到对应标签页（面板页只写存储，统一在此处理）
  pinnedTabsItem.watch((newIds, oldIds) => {
    const prev = oldIds ?? [];
    for (const id of newIds) if (!prev.includes(id)) void applyPanelOptions(id, true);
    for (const id of prev) if (!newIds.includes(id)) void applyPanelOptions(id, false);
  });

  // 存量标签页初始化：仅本浏览器会话首次运行（扩展刚装/重载时），
  // 之后 SW 唤醒不再重跑，避免与点击处理竞态把面板重新禁用
  void panelInitItem.getValue().then(async (done) => {
    if (done) return;
    await panelInitItem.setValue(true);
    const tabs = await browser.tabs.query({}).catch(() => []);
    for (const t of tabs) {
      if (t.id != null) await applyPanelForTab(t.id);
    }
  });

  // 新建标签页：立即按 pin 状态应用（默认未固定 → 面板不显示）
  browser.tabs.onCreated.addListener((tab) => {
    if (tab.id != null) void applyPanelForTab(tab.id);
  });

  // 按标签页的 setOptions 在导航后会重置：加载完成/换 URL 时重新应用
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== 'complete' && !changeInfo.url) return;
    void applyPanelForTab(tabId);
  });

  // 标签页关闭：清理 pin 状态
  browser.tabs.onRemoved.addListener((tabId) => {
    void pinnedTabsItem.getValue().then((ids) => {
      if (ids.includes(tabId)) void pinnedTabsItem.setValue(ids.filter((id) => id !== tabId));
    });
  });
});
