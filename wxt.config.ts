import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'AbstractWeb',
    description: 'Summarize the current page and chat with it, right in the side panel.',
    // side_panel 与 sidePanel 权限由 entrypoints/sidepanel 自动生成，勿重复声明
    permissions: ['storage', 'scripting'],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'AbstractWeb — 打开侧边栏摘要' },
  },
  vite: () => ({ plugins: [tailwindcss()] }),
});
