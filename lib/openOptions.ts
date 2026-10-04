/**
 * 在新标签页打开供应商管理页（extension options page）。
 * 深链：?edit=<providerId> 直达编辑表单；?add=1 直达新增预设网格。
 */
export function openProviderManager(opts?: { editProviderId?: string; add?: boolean }) {
  const params = new URLSearchParams();
  if (opts?.editProviderId) params.set('edit', opts.editProviderId);
  if (opts?.add) params.set('add', '1');
  const qs = params.toString();
  const url = browser.runtime.getURL('/options.html') + (qs ? `?${qs}` : '');
  void browser.tabs.create({ url });
}
