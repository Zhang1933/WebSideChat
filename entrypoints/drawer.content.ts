import { DRAWER_WIDTH, type DrawerMessage, type DrawerPostMessage } from '@/lib/drawerMessages';

/**
 * 标签独立抽屉：在每个普通网页注入 shadow DOM 宿主 + iframe（承载 sidepanel 应用）。
 * 可见性按 tabId 持久在 storage.session（页面导航后自动恢复）；
 * iframe 首次展开时才加载（关闭状态零开销），关闭后保留实例以便快速重开。
 * LLM 流跑在 Offscreen Document，抽屉销毁/重建不影响生成。
 */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],

  main() {
    let open = false;
    let iframe: HTMLIFrameElement | null = null;

    const host = document.createElement('div');
    host.id = 'webchat-drawer-host';
    host.style.cssText = 'all:initial;position:relative;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      .drawer {
        position: fixed;
        top: 0;
        right: 0;
        width: ${DRAWER_WIDTH}px;
        height: 100vh;
        max-width: 100vw;
        z-index: 2147483647;
        background: #fff;
        transform: translateX(100%);
        transition: transform 0.22s ease;
      }
      .drawer.open {
        transform: translateX(0);
        box-shadow: -4px 0 24px rgba(0, 0, 0, 0.25);
      }
      .drawer iframe {
        width: 100%;
        height: 100%;
        border: 0;
        display: block;
        color-scheme: light dark;
      }
    `;
    shadow.appendChild(style);

    const drawer = document.createElement('div');
    drawer.className = 'drawer';
    shadow.appendChild(drawer);

    function mountIframe() {
      if (iframe) return;
      iframe = document.createElement('iframe');
      iframe.src = browser.runtime.getURL('/sidepanel.html');
      drawer.appendChild(iframe);
    }

    function render() {
      if (open) mountIframe();
      drawer.classList.toggle('open', open);
      if (open) {
        // 首次挂载后再加入文档，保证过渡动画生效
        if (!host.isConnected) document.documentElement.appendChild(host);
      } else if (host.isConnected) {
        document.documentElement.appendChild(host); // 保持挂载以保留 iframe 实例
      }
    }

    async function setOpen(next: boolean, persist = true) {
      open = next;
      render();
      if (persist) {
        void browser.runtime
          .sendMessage({ type: 'drawer:set-open', open } satisfies DrawerMessage)
          .catch(() => {});
      }
    }

    // 初始状态：本 tab 的持久状态（导航恢复 / pin 自动展开已在 background 写入）
    void browser.runtime
      .sendMessage({ type: 'drawer:get-state' } satisfies DrawerMessage)
      .then((state) => {
        const s = state as { open?: boolean } | undefined;
        if (s?.open) void setOpen(true, false);
      })
      .catch(() => {});

    // 注册本 tab 存在抽屉脚本（background 据此决定图标点击走抽屉还是原生面板）
    void browser.runtime.sendMessage({ type: 'drawer:hello' }).catch(() => {});

    // 工具栏图标点击（background 转发）
    browser.runtime.onMessage.addListener((msg: DrawerMessage) => {
      if (msg?.type === 'drawer:toggle') {
        void setOpen(!open);
      }
    });

    // 抽屉内应用的 postMessage（× 关闭）
    window.addEventListener('message', (event) => {
      if (iframe && event.source !== iframe.contentWindow) return;
      const data = event.data as DrawerPostMessage | undefined;
      if (data?.type === 'webchat-drawer' && data.action === 'close') {
        void setOpen(false);
      }
    });
  },
});
