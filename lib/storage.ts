import { storage } from '#imports';
import { pruneConversations } from '@/lib/conversation';
import type { AppSettings, Conversation, Provider } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';

export const providersItem = storage.defineItem<Record<string, Provider>>('local:providers', {
  fallback: {},
  version: 1,
});

export const currentProviderIdItem = storage.defineItem<string | null>('local:currentProviderId', {
  fallback: null,
  version: 1,
});

export const settingsItem = storage.defineItem<AppSettings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
  version: 1,
});

export const conversationsItem = storage.defineItem<Record<string, Conversation>>(
  'local:conversations',
  { fallback: {}, version: 1 },
);

// ---------- providers ----------

export async function getProviders(): Promise<Record<string, Provider>> {
  return providersItem.getValue();
}

export async function saveProvider(provider: Provider): Promise<void> {
  const providers = await providersItem.getValue();
  providers[provider.id] = provider;
  await providersItem.setValue(providers);
  // 首条供应商自动设为当前使用
  const currentId = await currentProviderIdItem.getValue();
  if (!currentId || !providers[currentId]) {
    await currentProviderIdItem.setValue(provider.id);
  }
}

export async function deleteProvider(id: string): Promise<void> {
  const providers = await providersItem.getValue();
  delete providers[id];
  await providersItem.setValue(providers);
  // 删除当前供应商 → 自动指向列表第一项；列表为空则清空指针
  const currentId = await currentProviderIdItem.getValue();
  if (currentId === id) {
    const remaining = Object.values(providers).sort((a, b) => a.createdAt - b.createdAt);
    await currentProviderIdItem.setValue(remaining[0]?.id ?? null);
  }
}

export async function getCurrentProvider(): Promise<Provider | null> {
  const [providers, currentId] = await Promise.all([
    providersItem.getValue(),
    currentProviderIdItem.getValue(),
  ]);
  if (!currentId) return null;
  return providers[currentId] ?? null;
}

// ---------- settings ----------

export async function getSettings(): Promise<AppSettings> {
  return settingsItem.getValue();
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  const current = await settingsItem.getValue();
  await settingsItem.setValue({ ...current, ...patch });
}

// ---------- conversations ----------

/** 写入会话并做 LRU 淘汰 */
export async function persistConversation(conversation: Conversation): Promise<void> {
  const all = await conversationsItem.getValue();
  all[conversation.pageKey] = conversation;
  await conversationsItem.setValue(pruneConversations(all));
}
