export default defineBackground(() => {
  // 点击工具栏图标直接打开侧边栏（幂等，SW 每次启动都调用）
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('[AbstractWeb] setPanelBehavior failed:', err));
});
