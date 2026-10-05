import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'WebSideChat',
    description: 'websidechat能帮你摘要网页内容、回答网页问题。',
    // side_panel 与 sidePanel 权限由 entrypoints/sidepanel 自动生成，勿重复声明
    permissions: ['storage', 'scripting', 'offscreen'],
    host_permissions: ['<all_urls>'],
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
