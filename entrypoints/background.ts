export default defineBackground(() => {
  // 点击工具栏图标直接打开侧边栏（窗口级开关：点图标开、Chrome × 关，随窗口保持）
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('[WebChat] setPanelBehavior failed:', err));
});
