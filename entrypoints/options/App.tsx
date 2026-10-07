import { MessageSquareText, Server, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ProvidersPage } from '@/components/providers/ProvidersPage';
import { GeneralSettingsPage } from '@/components/settings/GeneralSettingsPage';
import { PromptSettingsPage } from '@/components/settings/PromptSettingsPage';
import { defaultUiLang, setUiLang, useT } from '@/lib/i18n';
import { settingsItem } from '@/lib/storage';
import { cn } from '@/lib/utils';

type Section = 'general' | 'providers' | 'prompts';

/** 设置整页（新标签页）：左侧导航 + 右侧内容；语言为最后一项 */
export default function App() {
  const t = useT();
  const params = new URLSearchParams(window.location.search);
  // 默认落在供应商设置；深链（?edit/?add）同样直达供应商页
  const [section, setSection] = useState<Section>('providers');

  // 显示语言随设置联动（storage.watch 跨页同步）
  useEffect(() => {
    void settingsItem.getValue().then((s) => setUiLang(s.uiLang ?? defaultUiLang()));
    return settingsItem.watch((s) => setUiLang(s.uiLang ?? defaultUiLang()));
  }, []);

  const NAV: { id: Section; label: string; icon: typeof Server }[] = [
    { id: 'providers', label: t('options.nav.providers'), icon: Server },
    { id: 'prompts', label: t('options.nav.prompts'), icon: MessageSquareText },
    { id: 'general', label: t('options.nav.general'), icon: Settings2 },
  ];

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-44 shrink-0 flex-col border-r">
        <div className="border-b px-4 py-4">
          <h1 className="text-base font-bold">WebSideChat</h1>
          <p className="text-[11px] text-muted-foreground">{t('options.subtitle')}</p>
        </div>
        <nav className="flex flex-col gap-0.5 p-2">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={cn(
                'flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors',
                section === id
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 p-6">
        <div className="mx-auto max-w-3xl">
          {section === 'general' && <GeneralSettingsPage />}
          {section === 'providers' && (
            <ProvidersPage initialEditId={params.get('edit')} initialAdd={params.has('add')} />
          )}
          {section === 'prompts' && <PromptSettingsPage />}
        </div>
      </main>
    </div>
  );
}
