import { useEffect, useState } from 'react';

export interface ActiveTab {
  id: number | null;
  url: string | null;
  title: string | null;
}

const EMPTY: ActiveTab = { id: null, url: null, title: null };

/**
 * 跟踪当前窗口的激活标签页（Side Panel 每窗口一个，随激活 tab 联动）。
 * <all_urls> host 权限使 tab.url / tab.title 可见，无需 tabs 权限。
 */
export function useActiveTab(): ActiveTab {
  const [tab, setTab] = useState<ActiveTab>(EMPTY);

  useEffect(() => {
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

    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return tab;
}
