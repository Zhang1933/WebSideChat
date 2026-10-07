import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'WebSideChat',
    // 描述经 Chrome i18n 按浏览器语言显示（public/_locales/{en,zh_CN}）
    default_locale: 'en',
    description: '__MSG_extDescription__',
    // side_panel 与 sidePanel 权限由 entrypoints/sidepanel 自动生成，勿重复声明
    // tabs：读取任意标签页 URL——检测"任意扩展的 options 页自动收起侧边栏"需要
    // （chrome-extension:// 源无法通过 host_permissions 授予，仅 tabs 权限可见）
    permissions: ['storage', 'scripting', 'offscreen', 'activeTab', 'tabs'],
    // 商店化权限方案：安装时仅声明视频站窄域（字幕提取的固定域名，免运行时弹窗）；
    // LLM 供应商域名在保存/拉模型时经 optional 按需申请（一次气泡，之后静默）
    host_permissions: ['https://*.youtube.com/*', 'https://*.bilibili.com/*', 'https://*.hdslb.com/*'],
    optional_host_permissions: ['<all_urls>'],
    action: { default_title: 'WebSideChat — 打开/关闭本页侧边栏' },
    // 注入式抽屉：把 sidepanel 应用（HTML/JS/CSS）暴露给网页 iframe 嵌入
    web_accessible_resources: [
      {
        resources: ['sidepanel.html', 'sidepanel-*.js', 'chunks/*.js', 'assets/*'],
        matches: ['http://*/*', 'https://*/*'],
      },
    ],
  },
  vite: () => ({ plugins: [tailwindcss()] }),
});
