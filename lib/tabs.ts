import { useEffect, useState } from 'react';

export interface ActiveTab {
  id: number | null;
  url: string | null;
  title: string | null;
}

const EMPTY: ActiveTab = { id: null, url: null, title: null };

/**
 * 从 URL 参数取 popup 模式的固定 tabId（sidepanel.html?tabId=xxx）。
 * 非弹窗场景返回 null → useActiveTab 走正常的"跟踪激活标签页"逻辑。
 */
export function popupTabIdFromUrl(): number | null {
  try {
    const v = new URLSearchParams(window.location.search).get('tabId');
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

/**
 * 跟踪指定标签页（popup 独立窗口模式：锁住来源标签页，不随窗口切换漂移）。
 */
function useTabById(tabId: number): ActiveTab {
  const [tab, setTab] = useState<ActiveTab>(EMPTY);
  useEffect(() => {
    async function refresh() {
      try {
        const t = await browser.tabs.get(tabId);
        setTab({ id: t.id ?? null, url: t.url ?? null, title: t.title ?? null });
      } catch {
        setTab(EMPTY); // 标签页已关闭
      }
    }
    refresh();
    const onUpdated = (
      id: number,
      changeInfo: { url?: string; status?: string; title?: string },
    ) => {
      if (id === tabId && (changeInfo.url || changeInfo.status === 'complete' || changeInfo.title)) {
        void refresh();
      }
    };
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.permissions.onAdded.addListener(() => void refresh());
    return () => {
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [tabId]);
  return tab;
}

/**
 * 跟踪当前窗口的激活标签页（Side Panel 每窗口一个，随激活 tab 联动）。
 * popup 独立窗口模式（URL 带 tabId=）时改为跟踪该固定标签页。
 * tab.url / tab.title 的可见性依赖：视频站窄域 host 权限、activeTab（点图标时授予）、
 * 或运行时按域申请的 optional 权限——三者任一命中即可见，无需 tabs 权限。
 */
export function useActiveTab(): ActiveTab {
  const popupTabId = popupTabIdFromUrl();
  const [tab, setTab] = useState<ActiveTab>(EMPTY);

  // popup 模式：走固定 tabId 的跟踪
  const fixedTab = useTabById(popupTabId ?? -1);
  useEffect(() => {
    if (popupTabId != null) setTab(fixedTab);
  }, [popupTabId, fixedTab]);

  useEffect(() => {
    if (popupTabId != null) return; // popup 模式不走激活页逻辑
    async function refresh() {
      try {
        const [active] = await browser.tabs.query({ active: true, currentWindow: true });
        setTab(active?.id != null ? { id: active.id, url: active.url ?? null, title: active.title ?? null } : EMPTY);
      } catch {
        setTab(EMPTY);
      }
    }

    refresh();

    const onActivated = () => void refresh();
    // 同一 tab 内导航（changeInfo.url）或加载完成（status complete）或标题变化时刷新
    const onUpdated = (
      _tabId: number,
      changeInfo: { url?: string; status?: string; title?: string },
    ) => {
      if (changeInfo.url || changeInfo.status === 'complete' || changeInfo.title) void refresh();
    };
    // 「授权本站」等按域授权成功后，tab.url 立即可见 → 主动刷新一次
    const onPermsAdded = () => void refresh();

    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.permissions.onAdded.addListener(onPermsAdded);
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.permissions.onAdded.removeListener(onPermsAdded);
    };
  }, [popupTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  return tab;
}
