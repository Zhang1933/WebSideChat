import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'WebChat',
    description: 'webchat能帮你摘要网页内容、回答网页问题。',
    // side_panel 与 sidePanel 权限由 entrypoints/sidepanel 自动生成，勿重复声明
    permissions: ['storage', 'scripting'],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'WebChat — 打开侧边栏' },
  },
  vite: () => ({ plugins: [tailwindcss()] }),
});
