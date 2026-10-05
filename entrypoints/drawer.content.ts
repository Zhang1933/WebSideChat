import { DRAWER_WIDTH, drawerOpenItem, drawerWidthItem, type DrawerMessage, type DrawerPostMessage } from '@/lib/drawerMessages';

/**
 * 标签独立抽屉：在每个普通网页注入 shadow DOM 宿主 + iframe（承载 sidepanel 应用）。
 * 可见性按 tabId 持久在 storage.session（页面导航后自动恢复）；
 * 左缘可拖拽调宽（全局持久化，双击重置）；iframe 首次展开时才加载（关闭状态零开销）。
 * LLM 流跑在 Offscreen Document，抽屉销毁/重建不影响生成。
 */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],

  main() {
    // 幂等：页面已有抽屉实例（图标按需注入遇到存活脚本，如 SW 重启丢了注册表）
    // → 只重新注册 hello，不重复注入第二个宿主
    if (document.getElementById('websidechat-drawer-host')) {
      void browser.runtime.sendMessage({ type: 'drawer:hello' }).catch(() => {});
      return;
    }

    let open = false;
    let iframe: HTMLIFrameElement | null = null;
    let width = DRAWER_WIDTH;
    let myTabId: number | null = null;

    // 获取本 tab 的 tabId（用于 watch 本 tab 的抽屉状态存储项）
    function getTabIdSync(): number {
      return myTabId ?? 0;
    }

    // content script 无法直接拿到自己的 tabId，通过 drawer:hello 的响应获取
    void browser.runtime
      .sendMessage({ type: 'drawer:hello' })
      .then((id) => {
        if (typeof id === 'number') {
          myTabId = id;
          // 拿到 tabId 后 watch 本 tab 的状态
          void drawerOpenItem(myTabId).watch((stored) => {
            if (stored !== open) void setOpen(stored, false);
          });
        }
      })
      .catch(() => {});

    const host = document.createElement('div');
    host.id = 'websidechat-drawer-host';
    host.style.cssText = 'all:initial;position:relative;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      .drawer {
        position: fixed;
        top: 0;
        right: 0;
        width: var(--websidechat-w, ${DRAWER_WIDTH}px);
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
      .resizer {
        position: absolute;
        left: 0;
        top: 0;
        height: 100%;
        width: 6px;
        cursor: col-resize;
        z-index: 1;
      }
      .resizer:hover, .resizer.active {
        background: rgba(0, 0, 0, 0.12);
      }
    `;
    shadow.appendChild(style);

    const drawer = document.createElement('div');
    drawer.className = 'drawer';
    shadow.appendChild(drawer);

    function applyWidth() {
      drawer.style.setProperty('--websidechat-w', `${width}px`);
    }

    // 左缘拖拽调宽：实时预览，松手持久化；双击重置默认宽度
    const resizer = document.createElement('div');
    resizer.className = 'resizer';
    drawer.appendChild(resizer);
    resizer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      resizer.classList.add('active');
      resizer.setPointerCapture(e.pointerId);
    });
    resizer.addEventListener('pointermove', (e) => {
      if (!resizer.classList.contains('active')) return;
      const max = Math.min(760, window.innerWidth - 160);
      width = Math.round(Math.min(max, Math.max(280, window.innerWidth - e.clientX)));
      applyWidth();
    });
    resizer.addEventListener('pointerup', (e) => {
      if (!resizer.classList.contains('active')) return;
      resizer.classList.remove('active');
      resizer.releasePointerCapture(e.pointerId);
      void drawerWidthItem.setValue(width);
    });
    resizer.addEventListener('dblclick', () => {
      width = DRAWER_WIDTH;
      applyWidth();
      void drawerWidthItem.setValue(width);
    });

    // 恢复上次保存的宽度
    void drawerWidthItem
      .getValue()
      .then((saved) => {
        if (typeof saved === 'number' && saved >= 280) {
          width = saved;
          applyWidth();
        }
      })
      .catch(() => {});

    function mountIframe() {
      if (iframe) return;
      iframe = document.createElement('iframe');
      iframe.src = browser.runtime.getURL('/sidepanel.html');
      // 跨域 iframe 需显式授予剪贴板写权限，否则复制按钮被宿主页 Permissions-Policy 拦截
      iframe.allow = 'clipboard-write';
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

    // 初始状态 + 持续同步：watch 本 tab 的存储项，
    // 无论状态从哪里变（本页切换/后台写入/storage 直改），都实时纠正本地开关
    void browser.runtime
      .sendMessage({ type: 'drawer:get-state' } satisfies DrawerMessage)
      .then((state) => {
        const s = state as { open?: boolean } | undefined;
        // 显式处理两种状态：open=true → 展开；open=false → 确保收起（纠正可能的竞态残留）
        void setOpen(s?.open === true, false);
      })
      .catch(() => {
        void setOpen(false, false); // 通信失败 → 默认关闭
      });

    // 工具栏图标点击（background 转发）
    browser.runtime.onMessage.addListener((msg: DrawerMessage) => {
      if (msg?.type === 'drawer:toggle') {
        void setOpen(!open);
      }
    });

    // 抽屉内应用的 postMessage（× 关闭 / 视频时间戳 seek）
    window.addEventListener('message', (event) => {
      if (iframe && event.source !== iframe.contentWindow) return;
      const data = event.data as DrawerPostMessage | undefined;
      if (data?.type === 'websidechat-drawer' && data.action === 'close') {
        void setOpen(false);
      }
      if (data?.type === 'websidechat-drawer' && data.action === 'seek' && typeof data.seconds === 'number') {
        const video = document.querySelector('video');
        if (video) {
          video.currentTime = data.seconds;
          video.play().catch(() => {});
        }
      }
    });

    // 扩展重载/更新后旧页面的 content script 失效：检测到上下文失效即
    // 移除注入的抽屉宿主，避免留下空白/失灵的僵尸侧栏；图标点击自动回退原生面板
    const invalidationTimer = setInterval(() => {
      if (browser.runtime?.id == null) {
        clearInterval(invalidationTimer);
        host.remove();
      }
    }, 2000);
  },
});
